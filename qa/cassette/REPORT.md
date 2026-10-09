# 卡带未来主义前端验收报告

2026-10-08，服务器 http://127.0.0.1:8765，Playwright 1.62.1 / Chromium 153.0.8010.12。
**136 项独立模拟浏览器断言全部通过，另有真实蓝牙验证通过；所有报告浏览器脚本错误为 0。**
9 项 Python 测试、三个产品脚本语法检查通过。
四个模拟 QA 脚本语法及 git diff --check 通过；历史 qa/plan/、qa/two-page/ 未覆盖。

| 脚本 | 通过 | 结果与截图 | 数据来源 |
| --- | ---: | --- | --- |
| qa/frontend_checks.cjs | 28 / 28 | two-page/results.json | 模拟 API / WS |
| qa/plan_checks.cjs | 45 / 45 | plan/results.json | 模拟 API / WS |
| qa/cassette_checks.cjs | 53 / 53 | targeted/results.json | 模拟，最终字体后重跑 |
| qa/cassette_final_checks.cjs | 10 / 10 | final/results.json | 模拟数据，真实浏览器缩放 |
| qa/real_frontend_check.cjs | 通过 | hardware/hardware-results.json | 真实本机蓝牙 |

## 功能与布局

- 首页 API 适配器、扫描状态和真实计数，两秒轮询、慢请求无重叠、隐藏暂停 / 恢复、连接错误 / Enter 重试通过。
- 启动保留标签、宽度和加载指示，重复触发只发一次请求；失败恢复，旧 GET / 新轮询不能擦除 POST 错误，成功跳转通过。
- 搜索排序、四设备限制、原生拨杆复选框、旋钮 Enter / Space / 直接档位、URL / Back / Forward 同步通过。
- 0 / 1 / 50 / 120 / 1000 台虚拟列表、末端键盘边界、节点复用、焦点保留 / 删除恢复通过。
- 四条不同颜色与虚线的曲线、原生键盘图例、断线重连、停止后历史、默认折叠冻结数据表及 50 行分页通过。
- 两页 320 / 375 / 768 / 1024 / 1440 / 2880px 无水平溢出；三列 / 两列 / 纵向 RX → SCOPE → ID 通过。
- 动效有限且会结束，减少动态效果时关闭装饰；两页字体失败回退仍可操作。运行时仅访问本机源。
- 最终本地 IBM Plex Mono 与 Microsoft YaHei / Microsoft YaHei UI、PingFang SC、sans-serif 回退通过。

人工查看最终 targeted/home-1440.png、targeted/monitor-four-curves-1440.png、
targeted/monitor-320.png 和 final/monitor-native-zoom50.png：模块、CRT、螺丝、磁带造型、
分格读数和响应式层次正常。空状态、错误、表格、字体回退、减少动态效果截图均保存。

## 原生缩放与模拟缩放

final/ 创建两个临时 Chromium profile，写入
partition.default_zoom_level: { x: log(factor) / log(1.2) }。
x 是默认分区的空相对路径键；[Chromium 官方实现](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)
读取字典而非标量。以 viewport: null、1440 × 1000 窗口、原始 DPR 1 启动，
未使用 CSS zoom / 页面缩放模拟，未接触已有用户 profile；临时目录关闭后经路径检查再删除。

| 原生缩放 | DPR | CSS 视口 | 外部窗口 | CSS zoom | 两页溢出 |
| --- | ---: | --- | --- | --- | --- |
| 100% | 1 | 1422 × 904 | 1440 × 1000 | 1 | 无 |
| 50% | 0.5 | 2844 × 1808 | 1440 × 1000 | 1 | 无 |

原生 50% 下监测页使用 120 台模拟设备与四曲线。
final/home-native-zoom50.png、final/monitor-native-zoom50.png 通过 CDP 直接捕获浏览器表面，
真实图像尺寸 1422 × 904。未操作 Chrome 设置菜单。
targeted/monitor-zoom50.png 是 CSS zoom: .5 补充模拟，二者明确区分。
可见性测试覆盖 document.hidden 并派发生命周期事件，未验证真实后台标签页节流。

## 性能、对比度与操作目标

| CPU | 渲染样本数 | 中位数 | P95 | 长任务 | 挂载卡片 | 曲线 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 倍 | 26 | 1.7ms | 2.6ms | 0 | 12 | 4 |
| 4 倍降速 | 25 | 7.0ms | 11.8ms | 0 | 12 | 4 |

采集时其余浏览器测试已结束。这是模拟数据下 render() 耗时，采集于最后中文字体回退调整前；
不代表蓝牙硬件延迟或其他浏览器性能。最终字体影响的布局、颜色、加载与触控目标另行通过。

计算样式的文字与启用控件对比度 **6.56–16.03:1**；最终字体专测 **7.23–11.51:1**。
图表线相对 CRT #070D09 为 **7.93–15.43:1**。采用 WCAG 相对亮度并合成祖先透明背景，
不将扫描线 / 噪点作为整体底色，不对禁用控件强制阈值；不是 APCA、像素逐点或视觉障碍用户实测。

375px 输入 / select 为 16px；品牌 44px、扫描键 54px、拨杆 44px、档位键 44px、旋钮 48px。
旋钮键盘焦点为 3px 琥珀实线。Back 恢复列表 / 页面滚动为 850 / 180px，
刷新为 865 / 180px；15px 来自虚拟卡片实测高度校正，在断言范围内。

## 真实蓝牙

真实硬件脚本在测试前两次确认蓝牙开启且扫描待命，仅启动并停止本次测试发起的扫描。

- 15 秒收到 41 台设备 / 370 条样本，挂载 13 个虚拟卡片。
- 应用选择 4 台，Chart.js 4 个 dataset，5 分钟档位有效。
- 停止并等在途数据稳定后 402 条样本；再等 6.2 秒，数量和图表时间末端均保持。
- 最终 scan_state: stopped、radio_state: on；页面错误 0。
- 桌面 / 移动截图分别为 hardware/real-scanning-1440.png、hardware/real-chart-375.png。

真实附近设备数量只是环境快照，不证明所有设备类型和蓝牙适配器兼容性。

## 复现与其余限制

BLUETOOTH_TEST_URL 指定服务器，BLUETOOTH_CHROME_PATH 指定 Chromium。
令 NODE_PATH 指向本机已有 Playwright 包，依次运行：

    node qa/frontend_checks.cjs
    node qa/cassette_checks.cjs
    node qa/plan_checks.cjs
    node qa/cassette_final_checks.cjs

本机已用的 NODE_PATH 为 C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules。

未实测 Safari、iOS 低电量模式、屏幕阅读器或真实后台节流。
字体、OFL 许可、官方来源和 SHA256 见 bluetooth_searcher/static/fonts/。
验收结束后扫描与临时验证服务器均已停止。正常查看仍可双击项目 start.bat。