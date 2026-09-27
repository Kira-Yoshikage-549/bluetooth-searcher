import asyncio
import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient

from bluetooth_searcher.scanner import (
    MAX_SAMPLES,
    ObservationStore,
    ScannerService,
    freshness,
)
from bluetooth_searcher.server import create_app


def device(address, name=None):
    return SimpleNamespace(address=address, name=name)


def advert(rssi=-58, local_name=None, companies=None, services=None):
    return SimpleNamespace(
        rssi=rssi,
        local_name=local_name,
        manufacturer_data=companies or {},
        service_uuids=services or [],
    )


class FakeScanner:
    def __init__(self, callback):
        self.callback = callback
        self.starts = 0
        self.stops = 0

    async def start(self):
        self.starts += 1

    async def stop(self):
        self.stops += 1


class StoreTests(unittest.TestCase):
    def test_paired_windows_name_identifies_anonymous_advertisement_by_address(self):
        store = ObservationStore(paired_names={"60B48383906B": "G的Redmi K70"})
        _, record, _ = store.observe(device("60:B4:83:83:90:6B"), advert(companies={0x038F: b"x"}), 1000)
        self.assertEqual(record["name"], "G的Redmi K70")
        self.assertIsNone(record["advertised_name"])
        self.assertEqual(record["possible_brand"], "Xiaomi")
        self.assertEqual(record["brand_source"], "Windows 已配对设备名推测")

    def test_anonymous_name_arrives_later_and_brand_source_stays_separate(self):
        store = ObservationStore()
        first = device("AA:BB:CC:DD:EE:01")
        store.observe(first, advert(companies={0x004C: b"x"}), 1000)
        early = store.snapshot(1000)[0][0]
        self.assertIsNone(early["name"])
        self.assertIsNone(early["possible_brand"])
        self.assertIn("Apple", early["broadcast_companies"][0])

        store.observe(first, advert(-62, "Redmi K70", services=["0000180a"]), 1200)
        late = store.snapshot(1200)[0][0]
        self.assertEqual(late["name"], "Redmi K70")
        self.assertEqual(late["possible_brand"], "Xiaomi")
        self.assertEqual(late["brand_source"], "广播名称推测")
        self.assertEqual(late["broadcast_companies"], early["broadcast_companies"])
        self.assertEqual(late["service_uuids"], ["0000180a"])
        self.assertEqual([sample["rssi"] for sample in store.snapshot(1200)[1][first.address]], [-58, -62])

    def test_same_name_different_address_does_not_merge_and_history_is_bounded(self):
        store = ObservationStore()
        a = device("AA:BB:CC:DD:EE:01", "Phone")
        b = device("AA:BB:CC:DD:EE:02", "Phone")
        for index in range(MAX_SAMPLES + 25):
            store.observe(a, advert(-60 - index % 3), 1000 + index)
        store.observe(b, advert(-40), 5000)
        devices, history = store.snapshot(5000)
        self.assertEqual(len(devices), 2)
        self.assertEqual(len(history[a.address]), MAX_SAMPLES)
        self.assertEqual(history[b.address][0]["rssi"], -40)
        self.assertNotEqual(history[a.address][0]["rssi"], history[b.address][0]["rssi"])
        self.assertEqual(freshness(1000, 6000), "stale")
        self.assertEqual(freshness(1000, 31000), "missing")

    def test_history_expires_but_device_remains_visible(self):
        store = ObservationStore()
        store.observe(device("AA:00"), advert(), 1000)
        devices, history = store.snapshot(301001)
        self.assertEqual(len(devices), 1)
        self.assertEqual(history["AA:00"], [])
        self.assertEqual(devices[0]["freshness"], "missing")

    def test_prune_drops_old_addresses_and_preserves_stopped_snapshot(self):
        store = ObservationStore(paired_names={})
        store.observe(device("AA:00"), advert(), 1000)
        self.assertEqual(len(store.snapshot(301001, trim=False)[1]["AA:00"]), 1)
        self.assertEqual(store.prune(301001), ["AA:00"])
        self.assertEqual(store.devices, {})


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.radio = "on"
        self.created = []

        async def probe():
            return self.radio

        def factory(callback):
            scanner = FakeScanner(callback)
            self.created.append(scanner)
            return scanner

        self.service = ScannerService(scanner_factory=factory, radio_probe=probe)

    async def test_start_stop_are_idempotent_and_late_callbacks_are_ignored(self):
        self.assertEqual((await self.service.start())["scan_state"], "scanning")
        await self.service.start()
        self.assertEqual(len(self.created), 1)
        self.assertEqual(self.created[0].starts, 1)

        self.created[0].callback(device("AA:01"), advert())
        self.assertEqual(self.service.status()["device_count"], 1)
        await self.service.stop()
        await self.service.stop()
        self.assertEqual(self.created[0].stops, 1)
        self.created[0].callback(device("AA:02"), advert())
        self.assertEqual(self.service.status()["device_count"], 1)

    async def test_powered_off_and_power_lost_stop_scanning(self):
        self.radio = "off"
        status = await self.service.start()
        self.assertEqual(status["scan_state"], "error")
        self.assertEqual(len(self.created), 0)
        self.assertIn("开启", status["error"])

        self.radio = "on"
        await self.service.start()
        self.radio = "off"
        await self.service.refresh_radio()
        self.assertEqual(self.service.status()["scan_state"], "error")
        self.assertEqual(self.created[0].stops, 1)
        self.assertIn("已关闭", self.service.status()["error"])

    async def test_mixed_samples_stream_once_to_multiple_clients(self):
        class Client:
            def __init__(self):
                self.messages = []

            async def send_json(self, message):
                self.messages.append(message)

        left, right = Client(), Client()
        self.service.clients.update((left, right))
        await self.service.start()
        self.created[0].callback(device("AA:01"), advert(-51))
        self.created[0].callback(device("BB:02"), advert(-71))
        self.created[0].callback(device("AA:01"), advert(-52))
        task = asyncio.create_task(self.service._publish_loop())
        try:
            await asyncio.wait_for(self._wait_for_messages(left, right), timeout=1)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await self.service.stop()
        for client in (left, right):
            message = client.messages[0]
            self.assertEqual(set(message["samples"]), {"AA:01", "BB:02"})
            self.assertEqual([x["rssi"] for x in message["samples"]["AA:01"]], [-51, -52])
            self.assertEqual([x["rssi"] for x in message["samples"]["BB:02"]], [-71])

    @staticmethod
    async def _wait_for_messages(*clients):
        while not all(client.messages for client in clients):
            await asyncio.sleep(0.01)


class ApiTests(unittest.TestCase):
    def test_http_and_websocket_share_one_scanner(self):
        made = []

        async def probe():
            return "on"

        def factory(callback):
            scanner = FakeScanner(callback)
            made.append(scanner)
            return scanner

        service = ScannerService(scanner_factory=factory, radio_probe=probe)
        with TestClient(create_app(service)) as client:
            self.assertIn("开始扫描", client.get("/").text)
            self.assertNotIn("signalChart", client.get("/").text)
            self.assertIn('id="signalChart"', client.get("/monitor").text)
            self.assertEqual(client.get("/api/status").json()["radio_state"], "on")
            with client.websocket_connect("/ws", headers={"origin": "http://testserver"}) as ws:
                snapshot = ws.receive_json()
                self.assertEqual(snapshot["type"], "snapshot")
                self.assertEqual(client.post("/api/scan/start").status_code, 200)
                self.assertEqual(client.post("/api/scan/start").status_code, 200)
                self.assertEqual(len(made), 1)
                delta = ws.receive_json()
                self.assertEqual(delta["status"]["scan_state"], "scanning")
                self.assertEqual(client.post("/api/scan/stop").json()["scan_state"], "stopped")
                self.assertEqual(made[0].stops, 1)


if __name__ == "__main__":
    unittest.main()
