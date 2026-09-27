# 蓝牙信号探测器

Windows 本地网页应用，用这台电脑的蓝牙适配器接收 BLE 广播，显示附近设备的 RSSI 和最近 60 秒／5 分钟曲线。网页和服务只在本机运行。

## 启动

1. 在 Windows 设置中开启电脑蓝牙。
2. 双击项目根目录的 `start.bat`。首次启动会用 Python 3.12 创建 `.venv`，并安装 `requirements.lock` 中锁定的依赖；这一步需要网络。以后启动可离线进行。
3. 浏览器会打开首页 `http://127.0.0.1:8765/`。点击“开始扫描”，启动成功后自动进入 `/monitor` 监测页；若蓝牙不可用，首页会显示错误提示，方便重试。在监测页点击设备即可将其加入信号曲线，最多同时对比 4 台。
4. 在启动脚本窗口按 `Ctrl+C` 停止服务。停止扫描按钮仅停止接收，保留本次运行的历史数据。

如果端口 8765 已被其他程序占用，启动脚本会显示提示。网页无需单独联网，Chart.js 已放在项目中。

## 怎么看信号

- RSSI 单位是 dBm。通常数值越接近 0，接收信号越强。网页把 ≥ −60、−80 至 −60、< −80 dBm 分别显示为强、中、弱。这是显示分级，不是精确距离。
- 列表中的数值是**上次收到的真实样本**。超过 5 秒没有新广播会显示“暂无新信号”，曲线断开；超过 30 秒显示“未再检测到”。这不代表设备一定关机。
- BLE 扫描只能看到正在广播的设备。手机打开蓝牙也可能暂时不广播，或使用随机地址。列表中出现一个注册为 Apple、Xiaomi 等公司的广播，也不能仅凭厂商编号断定设备就是对应品牌的手机。
- “广播厂商”来自广播数据中的公司编号；“可能品牌”来自广播名称，或与广播地址匹配的 Windows 已配对设备名。详情中分别列出来源。Windows 已配对名称是本机缓存，可能被用户改过。新配对设备的缓存名称会在下次启动后读取。
- 设备按本次运行中收到的蓝牙地址区分。地址轮换后会成为新设备。扫描时超过 5 分钟未再出现的设备会从列表移除；停止扫描后保留当时的列表与最近历史，直到关闭服务。

## 项目结构与接口

`bluetooth_searcher/scanner.py` 负责 BLE 扫描、Windows 蓝牙状态、厂商与已配对名称查找、历史缓存；`bluetooth_searcher/server.py` 提供本地网页和接口；`bluetooth_searcher/static/` 是网页资源；`launch.py` 与 `start.bat` 负责启动。

本地接口：

| 地址 | 作用 |
|---|---|
| `GET /` | 首页；点击开始扫描并成功启动后进入监测页 |
| `GET /monitor` | 实时设备、曲线与详情页面 |
| `GET /api/status` | 获取蓝牙、扫描及设备数量状态 |
| `POST /api/scan/start` | 开始扫描；蓝牙不可用时返回错误说明 |
| `POST /api/scan/stop` | 停止扫描 |
| `WS /ws` | 首次发送设备与历史快照，随后发送设备、样本和状态增量 |

服务仅监听 `127.0.0.1:8765`。它不自动配对或连接设备；扫描数据存于进程内存，服务退出后清空。

## 开发与验证

项目使用 Python 3.12。`requirements.txt` 锁定直接依赖，`requirements.lock` 锁定运行时依赖。开发测试需额外安装 `requirements-dev.txt`，然后运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check bluetooth_searcher\static\app.js
```

实际验证情况见 [TESTING.md](TESTING.md)。

厂商编号离线表生成自 [Bluetooth SIG Assigned Numbers](https://www.bluetooth.com/specifications/assigned-numbers/) 的 `company_identifiers.yaml`，于 2026-09-24 获取，包含 4038 个编号。图表资源是 [Chart.js 4.5.1](https://www.chartjs.org/)，其许可文本保存在 `bluetooth_searcher/static/vendor/LICENSE.chartjs.md`。
