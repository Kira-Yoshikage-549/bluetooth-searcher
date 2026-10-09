---
name: "蓝牙信号探测器"
description: "Cassette Futurism 本机 BLE 接收控制台"
colors:
  page: "#151817"
  surface: "#252a27"
  olive: "#3f4737"
  plastic: "#d2c5a4"
  screen: "#070d09"
  ink: "#efe8d4"
  muted: "#bab7a6"
  line: "#58604e"
  green: "#74ff9a"
  amber: "#ffb23e"
  orange: "#f08b48"
  rust: "#995234"
  warning: "#d84c42"
typography:
  display:
    fontFamily: '"IBM Plex Mono", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "clamp(34px, 5.7vw, 70px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '"IBM Plex Mono", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.5
  title:
    fontFamily: '"IBM Plex Mono", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: '"IBM Plex Mono", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: '"IBM Plex Mono", Consolas, monospace'
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.11em"
rounded:
  control: "2px"
  panel: "3px"
  cassette: "4px"
  screen-horizontal: "26px"
  screen-vertical: "18px"
spacing:
  tight: "8px"
  control: "12px"
  panel: "18px"
  group: "24px"
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "#171a15"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-primary-hover:
    backgroundColor: "{colors.amber}"
  button-quiet:
    backgroundColor: "#444b3e"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 17px"
  button-quiet-hover:
    backgroundColor: "#58614c"
    textColor: "#fff4d7"
  search-input:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px"
  navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  count-chip:
    backgroundColor: "#151d11"
    textColor: "{colors.green}"
    padding: "2px 5px"
  hardware-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  compare-switch:
    backgroundColor: "#10170c"
    rounded: "{rounded.control}"
    width: "31px"
    height: "22px"
  time-knob:
    width: "60px"
    height: "60px"
  crt-screen:
    backgroundColor: "{colors.screen}"
    textColor: "{colors.green}"
---

# Design System: 蓝牙信号探测器

<!-- 2026-10-08 从实际实现提炼。视觉依据：PRODUCT.md 与 .impeccable/surfaces/bluetooth-searcher-static-index-html.md；数值依据：bluetooth_searcher/static/styles.css、index.html、monitor.html、app.js、home.js、scan-transition.js。Frontmatter 是原始 token 层；.impeccable/design.json 补充阴影、动效、断点及组件预览。本文不代表浏览器或硬件验收结果。 -->

## Overview

**Creative North Star: "本机 BLE 接收控制台"**

以用户确认的 Cassette Futurism 为视觉世界：七八十年代科幻控制台的厚重外壳、米色塑料与黑底 CRT，组成一台可操作的本机接收设备。炭灰承担底座，军绿定义硬件分仓，绿色与琥珀色读数从暗屏中显现。模块编号、等宽字、压字标签、螺丝、散热槽与几何磁带均是该世界的组成部分。

视觉密度服务于状态和数据阅读。中文承担操作说明，英文缩写承担仪表标签，数字使用等宽数位；实体按键、对比拨杆与时间旋钮同时保留原生按钮、复选框和键盘行为。纹理是静止的材质，开机与换档是短促反馈，减少动态效果时信息立即完整呈现。

**Key Characteristics:**

- 炭灰与军绿硬件外壳，米色塑料与橙色操作键。
- 黑底 CRT、静态扫描线与噪点，绿色和琥珀色真实读数。
- 中文操作说明、英文仪表缩写、本地 IBM Plex Mono。
- 小半径分仓、实体按键、可操作拨杆和旋钮。
- 可见焦点、触摸目标、原生数据表与静态动效替代。

## Colors

暖塑料与低饱和硬件底色包围高亮荧光读数。Frontmatter 保留现有 CSS 变量的名称与十六进制值。Sidecar 中的八阶 OKLCH 色带是合成预览，不增加代码中的规范用色。

### Primary

- **荧光绿（green）**：CRT 标题、正常接收状态、强信号、设备选中边线及第一条曲线。
- **琥珀色（amber）**：焦点、待确认或过期状态、旋钮档位、中信号、第二条曲线与主键悬停。
- **操作橙（orange）**：主要扫描键、弱信号及第三条曲线，明确行动和低信号等级。

### Secondary

- **军绿（olive）**：控制台分仓、模块标题条与扫描控制区。
- **米色塑料（plastic）**：磁带、实体控件、标识、图表文字与第四条曲线。

### Tertiary

- **铁锈色（rust）**：琥珀／橙／铁锈色装饰条纹的末段。
- **警示红（warning）**：连接异常、适配器异常及错误提示前的实体警示灯。

### Neutral

- **深炭底（page）**：页面底座与暖色实体控件上的深色文字。
- **炭灰外壳（surface）**：导航与主面板。
- **暗 CRT（screen）**：屏幕与输入槽的深底。
- **暖浅文字（ink）**：中文正文与高优先级说明。
- **灰米文字（muted）**：辅助说明、状态标签与元信息。
- **灰绿接缝（line）**：重复使用的分隔线和面板接缝。

**The Red Lamp Rule.** 红色只用于警示灯；错误正文保持琥珀色或暖浅色，普通操作、弱信号和装饰条纹不使用红色。

## Typography

**Display / Body Font:** 本地 IBM Plex Mono，中文按 Microsoft YaHei、Microsoft YaHei UI、PingFang SC、sans-serif 回退。

**Label / Identifier Font:** IBM Plex Mono，英文仪表缩写与代码标识按 Consolas、monospace 回退；缩写与标识设置 `translate="no"`。

**Character:** Regular 与 SemiBold 两个真实字重组成仪表层级。大屏标题紧凑，压字标签有字距，中文保留自然阅读节奏；中文屏幕副标题字距为（0.03em）。

### Hierarchy

- **Display**：首页 CRT 的英文终端标题，使用 frontmatter 的 display 角色；手机改为（clamp(29px, 7.4vw, 52px)）。
- **Headline**：监测页标题；手机使用（22px）。
- **Title**：模块内中文标题，继承 title 角色。
- **Body**：提示与错误说明，使用 body 角色；短操作说明使用（12px，行高 1.9）。
- **Label**：压字标签、英文仪表缩写；一般元信息、时间码、数值表与脚注保持（11px）下限。
- **Readouts**：首页主要读数（28px，600），监测概要读数（23px，400），设备 RSSI（21px，400）；手机概要读数（20px）。
- **Inputs**：搜索与原生排序选择保持（16px）。

**The Legible Readout Rule.** 功能文字至少为 11px，输入与排序选择为 16px；数值使用等宽数位，长设备名在列表中截断，在详情中可换行完整阅读。

## Layout

通过分仓、标题条和内槽组织信息，面板之间保持（18px）间隔。导航和工作区容器的上限为（1600px），桌面左右留白合计（64px）；中等屏幕合计（40px），手机合计（28px）。首页控制台的上限为（1080px）。

当前监测工作区采用 RX／SCOPE／ID 三列：设备列下限（292px），详情列下限（230px），比例约为（1 : 1.85 : 0.85）。在（1199px）及以下，设备列为（310px），图表与详情在第二列上下排列；在（767px）及以下，依任务顺序叠放，列表独立滚动区高度范围为（240–390px），曲线高度为（275px）。在（400px）及以下，首页设备计数换为完整横行；监测概要中的 PWR／SCAN 分为两列，RX 独占下一行，用上边线分隔并将单位保持行内，行间距为（14px）；详情改为单列。此处保持文字和触摸目标原尺寸。两页具体组合由对应 surface brief 约束。

硬件内边距以小而明确的区段组织；frontmatter 只收录重复出现的间距步长，不推导额外数学网格。页面保留 safe-area 内边距、标题滚动间距和跳至内容链接。长设备名在列表截断，详情和消息允许换行；数据表的横向滚动局限于表格容器。虚拟列表保留焦点节点，并以设备 ID 恢复列表滚动锚点。

## Elevation & Depth

深度由实体结构产生：边框、内侧高光、厚下沿、近距离投影和 CRT 内部暗角共同表达外壳。按键处于抬起状态，屏幕处于内嵌状态；标签和旋钮拥有各自的局部压边，不依赖大面积悬浮模糊。

### Shadow Vocabulary

- **外壳厚度**（`inset 2px 3px 0 #939b7855, inset -3px -3px 0 #0d130c99, 0 2px 0 #717a6055, 0 10px 18px #0004, 0 3px 1px #000`）：控制台与面板共用。
- **抬起按键**（`inset 2px 3px 0 #ffffff55, inset -2px -4px 0 #0003, 0 5px 0 #535141, 0 7px 0 2px #10130f`）：实体按钮的内高光与底座。
- **CRT 内凹**（`inset 0 0 52px 18px #000d, 0 0 0 2px #7b8369, 0 0 0 5px #182012, 0 6px 2px #10160c`）：显示屏暗角与固定框。
- **压字标签**（`inset 0 1px #090c08, 1px 2px 0 #090c08, 2px 3px 0 #67705b55`）：模块编号的近距离厚度。

**The Physical Depth Rule.** 厚度通过边框、内侧高光和下沿阴影表达；按键按下沿垂直方向移动，CRT 使用向内的暗角，不给数据浮层添加持续漂浮动作。

## Shapes

操作控件使用 frontmatter 的 control 小半径，面板使用 panel，磁带使用 cassette。CRT 的弧面使用横向与纵向两条半径组成椭圆边角（26px / 18px）；圆形仅用于警示灯、螺丝、磁带轴与时间旋钮。

外壳普遍使用细硬边加厚底边，标题条与内部模块保持直角连接。螺丝、散热槽、磁带和三段色带以 CSS 几何构造；装饰图形使用 `aria-hidden`，不承载未解释的数据或操作。

## Components

### Buttons

实体键在静止时抬起，按下时移动（4px）并缩短底座阴影。主要扫描键使用操作橙，悬停与键盘焦点使用琥珀色；次要键使用深军绿色与暖浅文字。常规目标至少（44px），监测启停键至少（54px），首页开始键为（76px；手机 66px）。

全局焦点环为（3px）琥珀色外框与（4px）偏移。请求开始后禁用相应控制，显示旋转指示并保留原操作标签；首页失败保留重试路径。指示器采用（1s，steps(12, end)）转动，减少动态效果时静止但仍可见。

### Cards / Containers

硬件面板使用炭灰底、军绿标题条、压字模块编号、螺丝与厚下沿。面板标题内边距为（18px）；设备列表、曲线、详情分别拥有适合内容的内槽。设备条目以绿色边线和内侧竖线标识当前详情焦点，过期状态保留“上次测量”文字。

### Inputs / Fields

搜索框是黑底内槽，图标为装饰 SVG，真实名称来自 label。搜索输入目标为（44px）；父容器通过 `:focus-within` 显示（3px）琥珀色焦点环，输入本身不产生重复外框。排序保持原生 select，并明确米色背景与深色文字（目标至少 46px）。

### Navigation

导航使用真实链接。中文品牌与英文接收器标识形成固定标识组，右侧是页面入口和连接指示；悬停与焦点提高到琥珀色。手机隐藏重复仪表导航码，极窄屏幕的连接文字由主状态区承担。

### Chips / Status Lamps

设备计数是方角内嵌读数，不表现为动作。状态同时使用文字和灯色：正常为荧光绿，待确认为琥珀色，异常灯为警示红。设备详情徽标将“最近收到／暂无新信号／未再检测到”与颜色共同显示。

### Comparison Switch

对比拨杆保留真实 checkbox 与同一 label 命中区（至少 44px）。拨杆外形为（31 × 22px），选中时手柄横向移动（12px）并变绿；清晰的“对比”文字和可见键盘焦点伴随该状态。最多选择四台，满额时显示可读提示。

### Time Knob

时间旋钮是（60 × 60px）的真实 button，拥有触摸、Enter／Space 和方向键路径。左／下／Home 选择 60 秒，右／上／End 选择 5 分钟；指针对应（−45°／45°），当前档位和下一动作由可访问名称说明，提示文字通过 `aria-describedby` 关联。操作结果同时进入 URL。

### CRT / Scope

黑底 CRT 的扫描线和噪点保持静止。首次光栅扫过为（3s，steps(36, end)），首页标题以（83ms）逐字显现；开机闪动与换档雪花均是有限动画，换档雪花为（250ms，steps(3, end)）。装饰动效仅改变 transform／opacity，换档可被 Escape、页面离开、隐藏或减少动态效果打断。

曲线使用四种既有颜色及各自实线／虚线，不平滑补造采样；超过真实接收间隔的空白保持断线。图例是有 `aria-pressed` 的按钮，隐藏曲线同时以删除线表示。全部隐藏或无采样时，屏幕给出恢复或查看数据的下一步。

### Data Disclosure

“查看数据”使用原生 details／summary，默认折叠，目标至少（52px）。展开后提供数据快照时间、每台设备摘要、真实样本表和（50 行）分页；数据保持稳定直到用户刷新或改变选择／窗口。表格保留 caption 与列标题，页码使用 polite live region，URL 保存展开及页码状态。显示值使用中文 locale 的时间和数字格式。

## Do's and Don'ts

### Do:

- **Do** 保持炭灰、军绿、米色塑料与黑底 CRT 的材质分工。
- **Do** 用绿色、琥珀色、橙色、米色与不同虚线共同识别最多四条曲线。
- **Do** 为真实状态保留文字说明、未知态和恢复路径；装饰元素隐藏于辅助技术。
- **Do** 保持功能文字至少 11px、输入文字 16px、交互目标至少 44px，并提供琥珀色可见焦点。
- **Do** 让拨杆、旋钮、图例和数据表继续使用原生语义及键盘路径。
- **Do** 将短动效限制于 transform 与 opacity；减少动态效果时直接显示完整信息。

### Don't:

- **Don't** 将虚构遥测、装饰读数或模拟设备作为真实接收状态。
- **Don't** 将红色扩展到按钮、正文、普通信号分级或装饰条纹。
- **Don't** 以图片或纯装饰形状替代可操作的扫描键、对比复选框与时间按钮。
- **Don't** 让持续扫描线、噪点位移或磁带转动成为默认循环。
- **Don't** 只依赖曲线颜色、鼠标悬停或动画读取数据。
- **Don't** 将本轮指定的模块编号、等宽字体、CRT 纹理或几何硬件外壳视作风格违规。
