# 蓝牙信号探测器

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

在 Windows 本机查看附近 BLE 广播、比较接收信号的使用者。具体职业与使用频率未指定。

## Product Purpose

通过本机蓝牙适配器接收 BLE 广播，查看设备 RSSI、最近接收状态和历史曲线。RSSI 分级不表示精确距离，广播厂商也不等同于设备品牌。

## Operating Context

FastAPI 与 ScannerService 运行于本机，前端使用原生 HTML、CSS、JavaScript 和本地 Chart.js。首页 `/` 启动扫描，成功后进入 `/monitor`；失败留在首页并可重试。

## Capabilities and Constraints

用户于 2026-10-08 确认本轮完善两页，保留扫描启停、设备搜索排序、最多四台对比、60 秒／5 分钟时间窗、URL 与历史恢复、停止后历史、虚拟设备列表以及默认折叠的数值数据表。保留现有 HTTP／WebSocket 契约和工作区未提交修改。操作说明保持中文，仪表缩写使用英文。后端无需改动。

## Brand Commitments

名称为“蓝牙信号探测器”。用户指定卡带未来主义，参考七八十年代科幻飞船控制台；该视觉约束由 DESIGN.md 记录，不能以技能默认审美替代。

## Evidence on Hand

真实产品接口和逻辑见 bluetooth_searcher/server.py、scanner.py 与 static/。现有 qa/ 中的测试和截图是历史证据，不能作为本轮验证结果。演示数据必须明确标记为模拟；不得用装饰读数冒充真实扫描状态。

## Product Principles

- 真实接收状态与历史读数优先于装饰。
- 连接中断不能继续将缓存适配器状态显示为当前事实。
- 键盘、触摸、减少动态效果和数值表提供同等可操作路径。
- 可复现验证必须区分模拟浏览器数据和真实蓝牙硬件。

## Accessibility & Inclusion

遵循本项目 AGENTS.md 的键盘焦点、目标尺寸、动效、响应式和图表可访问要求。数据应可通过文字读取，不只依赖颜色、图形或鼠标悬停。
