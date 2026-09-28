# 前端设计审核修复验收记录

日期：2026-09-28。执行范围为 `bluetooth_searcher/static/` 和浏览器验收脚本。后端 HTTP、WebSocket 接口与数据格式未修改；真实蓝牙扫描未启动。未跟踪的根目录 `AGENTS.md` 保持原样。

| 审核问题 | 修复位置 | 验证证据 |
| --- | --- | --- |
| 触摸目标、输入字号、安全区与焦点 | `styles.css` 的通用控件、列表卡片、时间切换和安全区规则；`index.html`、`monitor.html` 的跳转链接与表单属性 | `results.json` 的 `mobileTargets`：输入和下拉 16px，品牌、扫描、对比和时间按钮均至少 44px；320–2880px 无横向溢出 |
| 加载反馈、状态提示和动画 | `home.js`、`app.js` 的原标签、预留 spinner 与稳定提示区域；`styles.css` 的一次性 SVG 波纹和减少动画规则 | `regression-results.json` 的失败重试、稳定按钮尺寸；`results.json` 的运行中切换减少动画 |
| 对比度、数值与文本语义 | `styles.css` 的文字、占位符和交互态颜色；`app.js` 的 `Intl` 格式化和不换行单位 | `results.json` 的 `contrast`：普通文字及主按钮所测组合均高于 4.5:1 |
| URL 状态与前进后退 | `app.js` 的 `readUrl`、`urlForState`、`writeUrl`、`popstate`；页面与设备列表滚动锚点存于 `history.state` | `results.json` 覆盖空选择、无效参数、失效设备、搜索防抖、分页、图例、Back/Forward 与刷新滚动恢复 |
| 大列表创建全部卡片、焦点丢失 | `app.js` 的 `renderDevices`、`focusCardControl`、高度缓存和 `ResizeObserver` | 0、1、50、120、1000 台模拟设备；1000 台可滚至末尾，50 台顺序 Tab，末尾跨窗口 Tab；120 台连续更新时焦点保持 |
| 画布图例缺乏键盘支持 | `app.js` 的 `renderLegend` 与固定颜色／线型；`monitor.html` 的 HTML 图例容器 | 空格键切换曲线、URL 同步与 Back 恢复；四条曲线同时渲染 |
| 图表没有可读数值替代 | `monitor.html` 的原生 `<details>`、汇总和表格；`app.js` 的采样快照与 50 条分页 | 120 条原始采样与汇总一致；超界页收敛、分页恢复、实时采样不移动表格、手动刷新更新数据 |

验证结果：9 项 Python 单元测试、27 项原有浏览器回归、45 项新增浏览器检查通过；前端脚本语法与 `git diff --check` 通过。浏览器检查使用本机无扩展的 Playwright Chromium、模拟 HTTP/WebSocket，不触发真实扫描。120 台、4 条曲线、每秒约 5 次更新时，普通 CPU 渲染中位数 2.1ms、P95 3.7ms；4 倍 CPU 降速时中位数 4.9ms、P95 15.2ms。两组均为 11 张挂载卡片、0 次记录到的超过 50ms 长任务。数值仅代表此环境和模拟数据，不代表真实后端请求时延。

截图： [首页 1440px](home-1440.png)、[首页 375px](home-375.png)、[启动失败](home-error-1440.png)、[实时监测](monitor-live-1440.png)、[空数据面板](data-empty-1440.png)、[数据第 3 页](data-page-1440.png)、[移动端数据](data-mobile-375.png)、[320px 长名称与数据](data-mobile-320.png)、[2880px 视口](monitor-2880.png)。

未验证：iOS 低电量模式与 Safari 实机、物理安全区、屏幕阅读器语音，以及浏览器自身的 50% 缩放。已检查 2880px 超宽视口；它不能等同于浏览器自身缩放。实际硬件扫描、设备适配器关闭场景和真实服务端 `POST` 时延也未在本轮浏览器检查中测量。
