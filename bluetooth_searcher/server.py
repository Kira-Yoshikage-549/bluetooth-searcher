"""Loopback-only HTTP and WebSocket API."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .scanner import ScannerService


STATIC_DIR = Path(__file__).parent / "static"


def create_app(service: ScannerService | None = None) -> FastAPI:
    scanner = service or ScannerService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await scanner.start_background()
        try:
            yield
        finally:
            await scanner.shutdown()

    app = FastAPI(title="蓝牙信号探测器", lifespan=lifespan)
    app.state.scanner = scanner
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html", media_type="text/html")

    @app.get("/monitor")
    async def monitor():
        return FileResponse(STATIC_DIR / "monitor.html", media_type="text/html")

    @app.get("/api/status")
    async def status():
        return scanner.status()

    @app.post("/api/scan/start")
    async def start():
        result = await scanner.start()
        return JSONResponse(result, status_code=200 if result["scan_state"] == "scanning" else 409)

    @app.post("/api/scan/stop")
    async def stop():
        result = await scanner.stop()
        return JSONResponse(result, status_code=200 if result["scan_state"] == "stopped" else 500)

    @app.websocket("/ws")
    async def websocket(websocket: WebSocket):
        origin = websocket.headers.get("origin")
        if origin and origin != f"http://{websocket.headers.get('host')}":
            await websocket.close(code=1008)
            return
        await websocket.accept()
        scanner.clients.add(websocket)
        try:
            await websocket.send_json(scanner.snapshot())
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            scanner.clients.discard(websocket)

    return app


app = create_app()
