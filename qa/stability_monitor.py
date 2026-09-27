"""Observe a running local scanner with two clients for an extended session."""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets


URL = "http://127.0.0.1:8765"


def status() -> dict:
    with urllib.request.urlopen(URL + "/api/status", timeout=4) as response:
        return json.load(response)


def rss_mb(pid: int) -> float:
    process = subprocess.run(
        ["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {pid}).WorkingSet64"],
        capture_output=True,
        text=True,
        timeout=8,
        check=True,
    )
    return round(int(process.stdout.strip()) / (1024 * 1024), 1)


async def receive(name: str, finish: asyncio.Event, totals: dict[str, int]) -> None:
    async with websockets.connect("ws://127.0.0.1:8765/ws", origin=URL, max_size=20_000_000) as socket:
        snapshot = json.loads(await socket.recv())
        if snapshot["type"] != "snapshot":
            raise AssertionError("Initial WebSocket message was not a snapshot")
        while not finish.is_set():
            try:
                event = json.loads(await asyncio.wait_for(socket.recv(), timeout=1))
            except asyncio.TimeoutError:
                continue
            totals[name] += sum(len(samples) for samples in event.get("samples", {}).values())


async def run(seconds: int, pid: int) -> None:
    finish = asyncio.Event()
    totals = {"client_a": 0, "client_b": 0}
    tasks = [asyncio.create_task(receive(name, finish, totals)) for name in totals]
    checkpoints = []
    started = datetime.now(timezone.utc).isoformat()
    start_clock = time.monotonic()
    try:
        while True:
            elapsed = time.monotonic() - start_clock
            for task in tasks:
                if task.done():
                    task.result()
                    raise AssertionError("A WebSocket receiver ended early")
            state = await asyncio.to_thread(status)
            if state["scan_state"] != "scanning":
                raise AssertionError(f"Scan stopped during stability run: {state}")
            checkpoint = {
                "elapsed_seconds": round(elapsed),
                "devices": state["device_count"],
                "fresh_devices": state["fresh_count"],
                "rss_mb": await asyncio.to_thread(rss_mb, pid),
                "samples_a": totals["client_a"],
                "samples_b": totals["client_b"],
            }
            checkpoints.append(checkpoint)
            print(json.dumps(checkpoint, ensure_ascii=False), flush=True)
            if elapsed >= seconds:
                break
            await asyncio.sleep(min(60, seconds - elapsed))
    finally:
        finish.set()
        await asyncio.gather(*tasks, return_exceptions=True)

    result = {
        "started_utc": started,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.monotonic() - start_clock),
        "clients": totals,
        "checkpoints": checkpoints,
    }
    Path(__file__).with_name("stability-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: stability-result.json written", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=1800)
    parser.add_argument("--pid", type=int, required=True)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.seconds, arguments.pid))
