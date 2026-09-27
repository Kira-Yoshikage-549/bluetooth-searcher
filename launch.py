"""Run the dashboard and open it once the local server responds."""

from __future__ import annotations

import socket
import sys
import threading
import time
import urllib.request
import webbrowser

import uvicorn


HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"


def check_port() -> bool:
    try:
        with socket.socket() as sock:
            sock.bind((HOST, PORT))
    except OSError:
        print(f"端口 {PORT} 已被占用。请关闭占用它的程序，再重新启动。", file=sys.stderr)
        return False
    return True


def open_when_ready() -> None:
    for _ in range(100):
        try:
            with urllib.request.urlopen(URL, timeout=0.5) as response:
                if response.status == 200:
                    webbrowser.open(URL)
                    return
        except Exception:
            time.sleep(0.1)


if __name__ == "__main__":
    if not check_port():
        raise SystemExit(1)
    threading.Thread(target=open_when_ready, daemon=True).start()
    print(f"本地页面：{URL}")
    print("按 Ctrl+C 停止服务。")
    uvicorn.run("bluetooth_searcher.server:app", host=HOST, port=PORT, log_level="warning", workers=1)
