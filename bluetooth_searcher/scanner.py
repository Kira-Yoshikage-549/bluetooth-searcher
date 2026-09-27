"""BLE collection and in-memory state for the local dashboard."""

from __future__ import annotations

import asyncio
import json
import re
import time
import winreg
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Callable

from bleak import BleakScanner
from winrt.windows.devices.bluetooth import BluetoothAdapter
from winrt.windows.devices.radios import RadioState


HISTORY_MS = 5 * 60 * 1000
MAX_SAMPLES = 3000
FRESH_MS = 5000
MISSING_MS = 30_000

COMPANY_IDS = {
    int(key): name
    for key, name in json.loads(
        (Path(__file__).parent / "company_identifiers.json").read_text(encoding="utf-8")
    ).items()
}

def brand_pattern(names: str) -> re.Pattern[str]:
    # ASCII boundaries work when Windows prefixes a Latin model with Chinese text.
    return re.compile(rf"(?<![A-Za-z])(?:{names})(?![A-Za-z])", re.I)


BRAND_PATTERNS = (
    (brand_pattern("iPhone|iPad|Apple"), "Apple"),
    (brand_pattern("Redmi|Xiaomi|POCO"), "Xiaomi"),
    (brand_pattern("Samsung|Galaxy"), "Samsung"),
    (brand_pattern("HUAWEI"), "Huawei"),
    (brand_pattern("HONOR"), "Honor"),
    (brand_pattern("OPPO"), "OPPO"),
    (brand_pattern("OnePlus"), "OnePlus"),
    (brand_pattern("vivo|iQOO"), "vivo"),
    (brand_pattern("Pixel|Google"), "Google"),
    (brand_pattern("Motorola|moto"), "Motorola"),
    (brand_pattern("Nokia"), "Nokia"),
)


def possible_brand(name: str | None) -> str | None:
    if not name:
        return None
    for pattern, brand in BRAND_PATTERNS:
        if pattern.search(name):
            return brand
    return None


def freshness(last_seen_ms: int, now_ms: int) -> str:
    age = now_ms - last_seen_ms
    if age < FRESH_MS:
        return "fresh"
    if age < MISSING_MS:
        return "stale"
    return "missing"


def windows_paired_names() -> dict[str, str]:
    """Read locally cached names of paired Bluetooth devices, without connecting."""
    result: dict[str, str] = {}
    for kind in ("BTHENUM", "BTHLE"):
        try:
            parent = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, rf"SYSTEM\CurrentControlSet\Enum\{kind}")
        except OSError:
            continue
        with parent:
            for index in range(winreg.QueryInfoKey(parent)[0]):
                key_name = winreg.EnumKey(parent, index)
                if not key_name.lower().startswith("dev_"):
                    continue
                address = key_name[4:].upper()
                with winreg.OpenKey(parent, key_name) as device_key:
                    for instance_index in range(winreg.QueryInfoKey(device_key)[0]):
                        instance_name = winreg.EnumKey(device_key, instance_index)
                        with winreg.OpenKey(device_key, instance_name) as instance:
                            try:
                                name, _ = winreg.QueryValueEx(instance, "FriendlyName")
                            except OSError:
                                continue
                            if name:
                                result[address] = str(name)
    return result


class ObservationStore:
    def __init__(self, paired_names: dict[str, str] | None = None) -> None:
        self.devices: dict[str, dict[str, Any]] = {}
        self.history: dict[str, deque[dict[str, int]]] = {}
        self.paired_names = windows_paired_names() if paired_names is None else paired_names

    def observe(self, device: Any, advertisement: Any, now_ms: int | None = None) -> tuple[str, dict[str, Any], dict[str, int]]:
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        address = str(device.address).upper()
        item = self.devices.get(address)
        if item is None:
            item = {
                "id": address,
                "address": address,
                "advertised_name": None,
                "system_name": None,
                "paired_name": self.paired_names.get(address.replace(":", "")),
                "company_ids": set(),
                "service_uuids": set(),
                "last_rssi": None,
                "last_seen_ms": now_ms,
            }
            self.devices[address] = item
            self.history[address] = deque()

        if advertisement.local_name:
            item["advertised_name"] = str(advertisement.local_name)
        if device.name:
            item["system_name"] = str(device.name)
        item["company_ids"].update(int(key) for key in advertisement.manufacturer_data)
        item["service_uuids"].update(str(value) for value in advertisement.service_uuids)
        item["last_rssi"] = int(advertisement.rssi)
        item["last_seen_ms"] = now_ms

        sample = {"time_ms": now_ms, "rssi": item["last_rssi"]}
        samples = self.history[address]
        samples.append(sample)
        self._trim_samples(samples, now_ms)
        return address, self.present(item, now_ms), sample

    @staticmethod
    def _trim_samples(samples: deque[dict[str, int]], now_ms: int) -> None:
        while samples and (samples[0]["time_ms"] < now_ms - HISTORY_MS or len(samples) > MAX_SAMPLES):
            samples.popleft()

    def present(self, item: dict[str, Any], now_ms: int) -> dict[str, Any]:
        name = item["advertised_name"] or item["paired_name"] or item["system_name"]
        company_ids = sorted(item["company_ids"])
        brand = possible_brand(name)
        return {
            "id": item["id"],
            "address": item["address"],
            "name": name,
            "advertised_name": item["advertised_name"],
            "system_name": item["system_name"],
            "paired_name": item["paired_name"],
            "company_ids": [f"0x{value:04X}" for value in company_ids],
            "broadcast_companies": [COMPANY_IDS.get(value, "未知厂商") for value in company_ids],
            "service_uuids": sorted(item["service_uuids"]),
            "possible_brand": brand,
            "brand_source": (
                "广播名称推测" if item["advertised_name"] else
                "Windows 已配对设备名推测" if item["paired_name"] else
                "系统名称推测"
            ) if brand else None,
            "last_rssi": item["last_rssi"],
            "last_seen_ms": item["last_seen_ms"],
            "freshness": freshness(item["last_seen_ms"], now_ms),
        }

    def prune(self, now_ms: int) -> list[str]:
        removed = []
        for address, item in list(self.devices.items()):
            self._trim_samples(self.history[address], now_ms)
            if now_ms - item["last_seen_ms"] > HISTORY_MS:
                del self.devices[address]
                del self.history[address]
                removed.append(address)
        return removed

    def snapshot(self, now_ms: int | None = None, *, trim: bool = True) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, int]]]]:
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        devices = []
        history = {}
        for address, item in self.devices.items():
            if trim:
                self._trim_samples(self.history[address], now_ms)
            devices.append(self.present(item, now_ms))
            history[address] = list(self.history[address])
        return devices, history

    def fresh_count(self, now_ms: int | None = None) -> int:
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        return sum(now_ms - item["last_seen_ms"] < FRESH_MS for item in self.devices.values())


async def windows_radio_state() -> str:
    try:
        adapter = await BluetoothAdapter.get_default_async()
        if adapter is None or not adapter.is_low_energy_supported:
            return "missing"
        radio = await adapter.get_radio_async()
        if radio is None:
            return "missing"
        return {
            RadioState.ON: "on",
            RadioState.OFF: "off",
            RadioState.DISABLED: "disabled",
        }.get(radio.state, "unknown")
    except Exception:
        return "unknown"


class ScannerService:
    def __init__(
        self,
        scanner_factory: Callable[[Callable[..., None]], Any] | None = None,
        radio_probe: Callable[[], Any] | None = None,
    ) -> None:
        self.store = ObservationStore()
        self.scan_state = "stopped"
        self.radio_state = "unknown"
        self.error: str | None = None
        self.stopped_at_ms: int | None = None
        self.scanner: Any = None
        self.clients: set[Any] = set()
        self.pending_devices: dict[str, dict[str, Any]] = {}
        self.pending_samples: dict[str, list[dict[str, int]]] = defaultdict(list)
        self._scanner_factory = scanner_factory or (
            lambda callback: BleakScanner(detection_callback=callback, scanning_mode="active")
        )
        self._radio_probe = radio_probe or windows_radio_state
        self._lock = asyncio.Lock()
        self._publisher: asyncio.Task | None = None
        self._monitor: asyncio.Task | None = None
        self._dirty = True

    async def start_background(self) -> None:
        await self.refresh_radio()
        self._publisher = asyncio.create_task(self._publish_loop())
        self._monitor = asyncio.create_task(self._monitor_loop())

    async def shutdown(self) -> None:
        for task in (self._publisher, self._monitor):
            if task:
                task.cancel()
        await asyncio.gather(*(task for task in (self._publisher, self._monitor) if task), return_exceptions=True)
        await self.stop()

    async def refresh_radio(self) -> str:
        state = await self._radio_probe()
        if state != self.radio_state:
            self.radio_state = state
            self._dirty = True
        if state in {"off", "missing", "disabled"} and self.scan_state == "scanning":
            await self.stop()
            self.scan_state = "error"
            self.error = "电脑蓝牙已关闭或不可用，扫描已停止。"
            self._dirty = True
        return state

    async def start(self) -> dict[str, Any]:
        async with self._lock:
            if self.scan_state == "scanning":
                return self.status()
            state = await self._radio_probe()
            self.radio_state = state
            if state != "on":
                self.scan_state = "error"
                self.error = {
                    "off": "电脑蓝牙已关闭，请在 Windows 设置中开启后重试。",
                    "missing": "未找到支持 BLE 的蓝牙适配器。",
                    "disabled": "蓝牙适配器已禁用，请先启用。",
                }.get(state, "无法确认蓝牙状态，请检查适配器。")
                self._dirty = True
                return self.status()
            try:
                scanner = self._scanner_factory(self._on_advertisement)
                await scanner.start()
            except Exception as exc:
                self.scan_state = "error"
                self.error = f"扫描启动失败：{exc}"
                self._dirty = True
                return self.status()
            self.scanner = scanner
            self.scan_state = "scanning"
            self.error = None
            self.stopped_at_ms = None
            self._dirty = True
            return self.status()

    async def stop(self) -> dict[str, Any]:
        async with self._lock:
            scanner = self.scanner
            self.scanner = None
            self.scan_state = "stopped"
            self.error = None
            if self.stopped_at_ms is None:
                self.stopped_at_ms = int(time.time() * 1000)
            self._dirty = True
            if scanner:
                try:
                    await scanner.stop()
                except Exception as exc:
                    self.scan_state = "error"
                    self.error = f"停止扫描失败：{exc}"
            return self.status()

    def _on_advertisement(self, device: Any, advertisement: Any) -> None:
        if self.scan_state != "scanning":
            return
        address, record, sample = self.store.observe(device, advertisement)
        self.pending_devices[address] = record
        self.pending_samples[address].append(sample)

    def status(self) -> dict[str, Any]:
        return {
            "scan_state": self.scan_state,
            "radio_state": self.radio_state,
            "error": self.error,
            "stopped_at_ms": self.stopped_at_ms,
            "fresh_count": self.store.fresh_count(),
            "device_count": len(self.store.devices),
        }

    def snapshot(self) -> dict[str, Any]:
        devices, history = self.store.snapshot(trim=self.scan_state == "scanning")
        return {"type": "snapshot", "status": self.status(), "devices": devices, "history": history}

    async def _publish_loop(self) -> None:
        last_tick = 0.0
        while True:
            await asyncio.sleep(0.2)
            now = time.monotonic()
            removed = self.store.prune(int(time.time() * 1000)) if self.scan_state == "scanning" else []
            if not self.pending_devices and not removed and not self._dirty and now - last_tick < 1:
                continue
            message = {
                "type": "delta",
                "status": self.status(),
                "devices": list(self.pending_devices.values()),
                "samples": dict(self.pending_samples),
                "removed": removed,
            }
            self.pending_devices.clear()
            self.pending_samples.clear()
            self._dirty = False
            last_tick = now
            for client in tuple(self.clients):
                try:
                    await asyncio.wait_for(client.send_json(message), timeout=1)
                except Exception:
                    self.clients.discard(client)

    async def _monitor_loop(self) -> None:
        while True:
            await asyncio.sleep(5)
            await self.refresh_radio()
