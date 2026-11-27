---
name: 飞书运营助手
description: 基于阳极氧化铝光学分束工作台的企业通讯录邮箱提取与重要文件实名签收对账系统
colors:
  bg-canvas: "#eef2f7"
  bg-surface: "#ffffff"
  bg-subtle: "#f6f8fb"
  bg-inset: "#edf1f7"
  bg-rail: "#111827"
  bg-rail-elevated: "#182234"
  bg-rail-active: "#1e2b42"
  rail-border: "#243247"
  rail-ink: "#f8fafc"
  rail-muted: "#94a3b8"
  ink: "#0f172a"
  ink-secondary: "#475569"
  ink-placeholder: "#5b6b82"
  border: "#d5dfec"
  border-strong: "#b6c5d8"
  border-subtle: "#e6ecf4"
  cobalt: "#1249d6"
  cobalt-hover: "#0e3cb5"
  cobalt-tint: "#edf3ff"
  cobalt-border: "#bfd2fc"
  cobalt-ink: "#103cb3"
  emerald: "#066a43"
  emerald-bg: "#eaf8f1"
  emerald-border: "#b3e3cc"
  amber: "#8a4206"
  amber-bg: "#fff6e8"
  amber-border: "#f7d69c"
  crimson: "#a61b29"
  crimson-bg: "#fdf0f1"
  crimson-border: "#f1bcc2"
  focus-ring: "#2563eb"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5
  mono-metric:
    fontFamily: "'SFMono-Regular', ui-monospace, Consolas, 'Liberation Mono', monospace"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.25
    fontFeature: "'tnum' 1"
  mono-data:
    fontFamily: "'SFMono-Regular', ui-monospace, Consolas, 'Liberation Mono', monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.75
    fontFeature: "'tnum' 1"
rounded:
  surface: "12px"
  control: "8px"
  tag: "6px"
  track: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  bay: "24px"
  canvas: "32px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.bg-surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-hover}"
    textColor: "{colors.bg-surface}"
  button-secondary:
    backgroundColor: "{colors.cobalt-tint}"
    textColor: "{colors.cobalt-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  button-ghost:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.crimson}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  button-success:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.bg-surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  input-field:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  rail-link:
    backgroundColor: "{colors.bg-rail}"
    textColor: "{colors.rail-muted}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  rail-link-active:
    backgroundColor: "{colors.bg-rail-active}"
    textColor: "{colors.bg-surface}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  mode-tab-active:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.cobalt}"
    rounded: "{rounded.tag}"
    padding: "7px 13px"
  chip:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "4px 6px 4px 10px"
  chip-department:
    backgroundColor: "{colors.cobalt-tint}"
    textColor: "{colors.cobalt-ink}"
    rounded: "{rounded.tag}"
    padding: "4px 6px 4px 10px"
  surface-bay:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px 28px"
  beam-panel:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "0px"
---

# Design System: 飞书运营助手

## Overview

**Creative North Star: "阳极氧化铝光学分束舱 (Anodized Aluminum & Optical Split-Stream Bay)"**

飞书运营助手以精密硬件级「阳极氧化铝光学分束工作台」重塑企业通讯录邮箱提取、重要文件实名签收与增量对账。微冷铝银底板承载纯白 `1px` 发丝边层板，立式深炭黑结构导轨收拢管理模块与环境身份上下文；激活工作舱顶部的 `2px` 实色光学聚焦轨与「光学分束比例条」精确呈现输入源、在职匹配、有效输出以及已签收、待确认、离职剔除的实时分流，让每一次发信圈人与合规审计都具备仪器级确定感。

系统在空间架构上严格执行管理工作台与员工确认单据的双壳层物理隔离：管理端采用左侧立式导轨配高密度双舱工作面或对账台账，服务批量工号解析、快照锁定与双通道催办；全体员工从企业邮件或飞书卡片点击确认短链时，进入剥离全部后台导航干扰的净白光学核验单据，首屏直达文件版本、本人飞书实名通行条、必读说明与电子回执凭证。

工程与视觉表达同步服从严格的 `Content-Security-Policy`（`default-src 'self'`、`style-src 'self'`），零外部字体或样式 CDN、零内联 `style` 属性，所有比例刻度均由固定坐标系 SVG 几何属性与高阻尼曲线驱动。本系统明确拒绝松散的传统后台圆角卡片堆叠、装饰性悬浮阴影、霓虹光晕与大数字看板模板。

**Key Characteristics:**
- 微冷铝银底板（`#eef2f7`）与纯白 `1px` 发丝边（`#d5dfec`）层板构成零阴影工作面，立式深炭黑结构导轨（`#111827`）锚定管理模块与环境身份。
- 签名组件「光学分束比例条」以等宽制表读数配合 `1000×6` 零内联样式 SVG 分束轨，直观映射有效输出、已确认与异常待办比例。
- 激活工作舱与单据通过舱顶 `2px` 实色光学导轨切换极性（默认激光钴蓝 `#1249d6`，就绪或已签收切换为核准青绿 `#066a43`）。
- 管理端双舱/台账壳层（`256px` 导轨 + `1220px` 画布）与员工端零干扰核验单据壳层（`748px` 居中单据）按路由与权限彻底分离。
- 中文系统无衬线固定 `rem` 字阶负责阅读，所有工号、企业邮箱、确认短链、令牌前缀与回执编号强制归入等宽制表数字轨。

## Colors

整套色板以微冷阳极氧化铝灰白与深炭黑结构轨为无彩底座，并将方向契约中的初始光学色值（`#1D5EFF`、`#067647`、`#B45309`）收敛校准为满足白底与浅色语义底板 WCAG AA（≥ 4.5:1）文本对比度的实装色阶（`#1249d6`、`#066a43`、`#8a4206` 与 `#a61b29`）。

### Primary
- **激光钴蓝 Laser Cobalt** (`#1249d6`): 主操作按钮、默认激活舱顶 `2px` 光学导轨、分段切换选中文字、链接及复选框强调色。
- **深钴悬停 Cobalt Hover** (`#0e3cb5`): 主操作按钮与文字链接的指针悬停加深态。
- **钴墨正文 Cobalt Ink** (`#103cb3`): 次级联动按钮、部门标签、数量徽章与确认短链代码胶囊上的高对比蓝字。
- **极性浅钴底 Cobalt Tint** (`#edf3ff`): 次级按钮、通讯录选择触发器、分束条激活过滤节点、部门标签及演示/授权提示条底色。
- **浅钴描边 Cobalt Hairline** (`#bfd2fc`): 所有浅钴底色组件与提示条的 `1px` 边界线。
- **光学焦点环 Focus Ring** (`#2563eb`): 全局键盘 `:focus-visible` 的 `2px` 实线外轮廓色。

### Secondary
- **深炭黑导轨 Carbon Rail** (`#111827`): 管理端左侧立式主导航轨与员工单据页紧凑顶栏底色，同时作为页面 `theme-color`。
- **炭黑抬升层 Carbon Rail Elevated** (`#182234`): 导轨内品牌徽标槽、环境状态胶囊、演示视角切换框、会话信息盒及导航悬停态底色。
- **炭黑激活槽 Carbon Rail Active** (`#1e2b42`): 当前所在管理模块的导航项选中态底色。
- **导轨发丝边 Rail Border** (`#243247`): 炭黑导航轨与右侧冷铝画布及底部会话区的 `1px` 结构分割线。
- **导轨亮白字 Rail Ink** (`#f8fafc`): 炭黑导轨内的品牌标题、当前用户名与悬停高亮文字。
- **导轨静默灰 Rail Muted** (`#94a3b8`): 未激活导航模块与导轨次级会话标签文字。

### Tertiary
- **核准青绿 Verified Emerald** (`#066a43`): 有效企业邮箱读数、已实名签收读数、复制成功反馈按钮、已完成结果舱/已签收单据的 `2px` 顶轨及成功提示字色；配 **青绿浅底** (`#eaf8f1`) 与 **青绿描边** (`#b3e3cc`) 承载电子回执凭证盒与成功通告。
- **异动琥珀 Anomaly Amber** (`#8a4206`): 异常剔除项读数、在职待确认状态、缺企业邮箱内联警示及确认截止倒计时文字（注：`6px` SVG 光学图形分束条段 `.beam-seg-amber` 采用高饱和 `#d97706` 以拉开与青绿条段的图形辨识度）；配 **琥珀浅底** (`#fff6e8`) 与 **琥珀描边** (`#f7d69c`) 承载结果异常提示框。
- **阻断绯红 Alert Crimson** (`#a61b29`): 删除/停用危险描边按钮、超限校验文本与全局错误通告字色；配 **绯红浅底** (`#fdf0f1`) 与 **绯红描边** (`#f1bcc2`) 承载错误告警条与危险按钮边框。

### Neutral
- **微冷铝银底板 Cool Aluminum Canvas** (`#eef2f7`): 全局 `body` 与主画布底色，衬托纯白层板的清晰边界。
- **净白光学层板 Pure Optical Surface** (`#ffffff`): 双舱工作面、分束面板、任务表单、确认单据与模态选择器的主承载表面。
- **微凹拉丝底 Subtle Recessed Well** (`#f6f8fb`): 多行工号输入槽、只读邮箱输出框、表格列头、空状态虚线舱、内联子表单与催办双栏底色。
- **内嵌轨道槽 Inset Track** (`#edf1f7`): 极性分段标签外框槽、已归档徽章底色及 `5px`–`6px` SVG 进度条底轨。
- **标准发丝边 Hairline Border** (`#d5dfec`): 工作舱外框、双舱中缝、分束节点竖向分隔及区块底部分割线。
- **强化控件描边 Control Strong Border** (`#b6c5d8`): 输入框、下拉框、幽灵按钮、成员标签与搜索框在纯白表面上的清晰轮廓线。
- **微弱行分割线 Row Subtle Divider** (`#e6ecf4`): 对账表格数据行、匹配明细行与任务列表行的轻量水平分隔。
- **深板岩主墨色 Primary Slate Ink** (`#0f172a`): 标题、正文、表单值与表格主字段文字。
- **次级板岩灰 Secondary Slate** (`#475569`): 页头说明、表头标签、元数据行、表单提示与空状态正文。
- **校准占位灰 Calibrated Placeholder** (`#5b6b82`): 输入框与文本域 `::placeholder` 专用色，在 `#ffffff` 与 `#f6f8fb` 上均满足 ≥ 4.5:1 对比度。

### Named Rules
**The Optical Polarity Rule.** 激光钴蓝（`#1249d6`）专司主操作按钮、默认激活舱顶 `2px` 聚焦轨、选中分段极性与链接；一旦工作舱完成邮箱解析或员工完成实名签收，舱顶导轨与主反馈立即移交核准青绿（`#066a43`），不让蓝色在完成态继续抢占视觉焦点。

**The Tri-Modal Signal Rule.** 成功签收（`#066a43`）、待确认/异动（`#8a4206`）与错误阻断（`#a61b29`）严禁仅靠颜色传达，必须同时绑定明确中文状态词与语义图标或 `6px` 极性圆点，且文本在各自浅底（`#eaf8f1`、`#fff6e8`、`#fdf0f1`）上保持 ≥ 4.5:1 对比度。

**The Carbon-Only Rail Rule.** 深炭黑底色族（`#111827`、`#182234`、`#1e2b42`）仅限于管理端侧边导航轨与员工单据页顶栏使用，主画布内禁止出现深色卡片或黑底浮层，确保核验与对账界面的净白通透。

## Typography

**Display Font:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
**Body Font:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
**Label/Mono Font:** `'SFMono-Regular', ui-monospace, Consolas, 'Liberation Mono', monospace`

**Character:** 系统中文无衬线字体提供冷静、扎实、零加载闪烁的原生桌面阅读质感；等宽字体与制表数字轨则赋予工号、邮箱、哈希回执和分束读数如精密仪器标尺般的纵向秩序。

### Hierarchy
- **Display** (`650`, `1.5rem` / `24px`, `1.35`, `-0.025em`): 管理工作台各模块主标题 `h1`；员工确认单据头标题微调为 `1.4375rem`（`1.4` 行高），窄屏 `≤740px` 收敛至 `1.3125rem` 与 `1.1875rem`。
- **Headline** (`650`, `1.0625rem` / `17px`, `1.45`, `-0.015em`): 双舱面板标题 `h2`、表单分节标题与模态对话框标题。
- **Title** (`600`, `1rem` / `16px`, `1.45`): 任务与项目名册主行标题、空状态标题、回执标题及导轨品牌名（品牌名为 `650` 字重、`-0.02em` 字距）。
- **Body** (`400`, `0.875rem` / `14px`, `1.6`–`1.8`): 全局默认正文、表单输入值、对账表格单元与单据必读说明正文；页头副标题与单据必读正文均锁定 `max-width: 68ch` 最佳阅读行宽。
- **Label** (`500`–`600`, `0.75rem` / `12px` 与按钮/表格控件 `0.8125rem` / `13px`, `1.5`–`1.65`): 表单字段标题、辅助提示、表格列头、分束节点标签与紧凑状态徽章（徽章与导轨内联代码为 `0.6875rem` / `11px`）。
- **Mono Metric & Data** (`650` 读数 `1.25rem` / `20px`；`400` 数据 `0.75rem`–`0.875rem`): 光学分束比例条主读数、工号输入与展示、空格分隔邮箱输出框、确认短链、令牌前缀及电子回执编号。

### Named Rules
**The Fixed-Rem Operate Scale Rule.** 全站采用固定 `rem` 操作字阶（`0.75rem`–`1.5rem`），禁用流式 `clamp()` 营销巨字，保证飞书工作台内嵌视口、桌面宽屏与手机邮件外链视口下的信息密度恒定可控。

**The Monospace Ledger Rail Rule.** 所有员工工号、企业邮箱、确认短链、API 令牌前缀与电子回执编号一律使用等宽字体（`--font-mono`），且全部计数、完成率与时间戳强制启用 `font-variant-numeric: tabular-nums` 纵向对齐。

## Layout

系统根据路由角色切换两套独立应用壳层（方向契约初稿中的 `228px` 导轨与 `680px` 单据宽度在实装中定型为更从容的 `256px` 导轨与 `748px` 单据版心）：

- **管理工作台壳层（`.app-shell--ops`）**：桌面端采用 `256px minmax(0, 1fr)` 双列网格，`100dvh` 吸顶深炭黑导轨（内边距 `20px 14px 16px`）固定在左侧；右侧主画布内层最大宽度 `1220px`（桌面内边距 `28px 32px 52px`）。核心邮箱提取与权限配置采用一体式双舱容器 `.workspace`（`1fr : 1.12fr`，最小高度 `540px` / 权限页 `420px`），左右舱共享同一外框并以 `1px solid #d5dfec` 竖向发丝边平分，不拆成两张独立卡片；任务详情内的双通道催办区采用 `1.15fr : 0.85fr` 双栏内凹面板（间距 `24px`，中置竖向分割线）。
- **员工确认单据壳层（`.app-shell--sheet`）**：面向 `/ack/:slug` 与 `/my/acks`，完全移除左侧后台导航轨，改为顶部 `54px` 最小高度的深炭黑紧凑顶栏与居中 `748px` 最大宽度的单据画布（画布内边距 `22px 24px 44px`，单据内边距 `30px 34px`），确保员工聚焦阅读与实名签署。
- **响应式断点节奏**：
  - `≤1040px`：画布内边距收紧至 `22px 20px 40px`，面板内边距收紧至 `20px 22px`；五列分束条折行为双列网格（首格基准项通栏），双通道催办区转为上下堆叠并以水平分割线衔接。
  - `≤880px`：管理壳层从左侧立式导轨折算为顶部横栏（`grid-template-rows: auto 1fr`），功能模块转为横向可滚动条，隐藏底部冗长会话盒；四列分束条折算为 `2×2` 网格。
  - `≤740px`：一体式双舱 `.workspace`、二/三列表单网格及回执定义列表全部转为单列堆叠；左舱右描边自动切换为底描边（若紧邻带 `2px` 光学顶轨的结果舱则自动消隐底边，避免双线冲突）；单据内边距收敛至 `16px`。
  - `≤560px`：三列分束条折算为单列；折叠后的管理导航切换为 `2×2` 等宽网格，杜绝窄屏横向截断。

## Elevation & Depth

本系统采用「阳极氧化铝色调分层 + `1px` 发丝边」的平面工程深度模型，主画布上的工作舱、分束条、表格与单据全程零外部阴影。视觉纵深由四层冷灰白阶梯自然建立：微冷铝银画布（`#eef2f7`）托起净白光学层板（`#ffffff` + `1px solid #d5dfec`），层板内部以微凹拉丝底（`#f6f8fb`）容纳文本域、表格头与子表单，再以最深一层的内嵌轨道槽（`#edf1f7`）承载分段标签底座与 `6px` SVG 进度槽，左侧则由深炭黑导轨（`#111827`）确立结构边界。

### Shadow Vocabulary
- **模态选择器浮层阴影 Modal Picker Elevation** (`box-shadow: 0 20px 48px rgba(15, 23, 42, 0.22)`，配 `::backdrop` `rgba(15, 23, 42, 0.48)`): 全系统唯一允许的外部投影，专属于原生 `<dialog>` 通讯录成员与部门选择器（`.picker-dialog`），且对话框自身设为 `border: 0` 以避免描边与阴影重复叠加。
- **分束节点内嵌极性轨 Active Beam Inset** (`box-shadow: inset 0 -2px 0 #1249d6`): 用于光学分束比例条中当前激活筛选节点的底部内嵌指示线，在零高度变化下锁定选中态。

### Named Rules
**The Zero-Shadow Workspace Rule.** 主画布上的所有工作舱、光学分束面板、对账表格与确认单据在静止及悬停态均保持零外部阴影，层级仅由冷铝底板（`#eef2f7`）、净白层板（`#ffffff`）、内凹浅槽（`#f6f8fb` / `#edf1f7`）与 `1px` 发丝边建立；外部阴影仅授予原生 `<dialog>` 模态选择器。

**The Active Top-Rail Focus Rule.** 面板焦点通过容器顶部 `2px` 实色光学导轨（`#1249d6` 或 `#066a43`）与分束节点底部 `inset 0 -2px 0 #1249d6` 内嵌线表达，禁止叠加模糊发光（glow）或悬浮抬升位移。

## Shapes

整体几何语言遵循外圆内敛的同心阳极氧化铝倒角阶梯，边缘利落且无胶囊化泛滥：

- **外层工作舱、分束面板与模态框**：统一采用 `12px` 圆角（`--radius-surface`）并配 `overflow: hidden`，使舱顶 `2px` 实色光学导轨与面板圆角精密贴合裁剪。
- **交互控件、输入框、通告条与内嵌子面板**：统一采用 `8px` 圆角（`--radius-control`），包括全部按钮、输入框、分段切换外槽、身份通行条与电子回执盒。
- **内层标签、徽章与代码胶囊**：统一采用 `6px` 圆角（`--radius-tag`），嵌套在 `8px` 分段槽或选择区域内部时形成精准的同心内缩关系（`3px` 外槽内边距 + `6px` 按钮圆角）。
- **仪器级微几何**：光学分束 SVG 轨道采用 `2px`–`3px` 微圆角；双舱接缝与分束条内部节点保持 `0px` 直角齐平拼接；状态极性点与导轨激活点采用 `6px × 6px` 正圆（`50%`）。
- **边框策略**：静态面板用 `1px solid #d5dfec`，表单输入与幽灵按钮升级为 `1px solid #b6c5d8` 强化可交互边界，仅空白待输出区（`.result-empty`）使用 `1px dashed #b6c5d8` 虚线框示意待填入槽位。

## Components

所有交互控件共享 `150ms cubic-bezier(0.16, 1, 0.3, 1)` 的色彩与边框过渡，并在 `prefers-reduced-motion: reduce` 下全局关闭过渡与旋转动画。

### Buttons
紧凑、克制且极性分明的操作触发器，拒绝渐变填充与投影抬升。
- **Shape:** `8px` 圆角（`--radius-control`），常规按钮最小高度 `38px`（内边距 `8px 14px`，字号 `0.8125rem`，字重 `550`）；主表单提交按钮通栏 `42px` 高；员工单据确认主按钮通栏 `44px` 高以便移动端拇指点按。
- **Primary:** 激光钴蓝实底（`#1249d6`）配纯白文字（`#ffffff`），用于页面唯一核心推进动作（如「查询企业邮箱」「新建任务」「确认已读」）。
- **Hover / Focus:** 主按钮悬停切换至深钴蓝 `#0e3cb5`；键盘焦点统一呈现 `2px solid #2563eb` 外轮廓（`outline-offset: 2px`）；禁用态透明度降至 `0.46` 并显示 `not-allowed` 光标。
- **Secondary / Ghost / Danger / Success:** 次级联动按钮采用浅钴底 `#edf3ff` + `#bfd2fc` 描边 + `#103cb3` 文字（悬停 `#dfeaff`）；幽灵辅助按钮采用净白底 `#ffffff` + `#b6c5d8` 描边 + `#0f172a` 文字（悬停 `#f6f8fb` 底与 `#94a7bf` 描边）；危险按钮采用净白底 + `#f1bcc2` 描边 + `#a61b29` 文字（悬停 `#fdf0f1`）；剪贴板复制成功瞬间在 `2.4s`–`2.5s` 内切换为核准青绿实底按钮（`#066a43` 配白字与勾选图标）。另有无框文字按钮（`.text-button`，`0.75rem` 钴蓝悬停下划线）与 `6px` 圆角图标按钮（`.icon-button`）。

### Chips
用于通讯录受众圈选、API 权限勾选与任务生命周期标记的高密度标签组。
- **Style:** `6px` 圆角（`--radius-tag`），字号 `0.75rem`。普通成员标签为纯白底 `#ffffff` + `#b6c5d8` 描边 + `#0f172a` 文字，内嵌 `4px` 圆角移除图标按钮；部门标签与已勾选权限范围标签（`.department-chip`）切换为浅钴底 `#edf3ff` + `#bfd2fc` 描边 + `#103cb3` 文字。
- **State:** 只读状态徽章（`.badge`，`0.6875rem`、`600` 字重）区分三态：`收集中 / 本人已签收 / 可用`（`#eaf8f1` 底 + `#b3e3cc` 边 + `#066a43` 字）、`待实名签收`（`#fff6e8` 底 + `#f7d69c` 边 + `#8a4206` 字）、`已截止归档 / 已停用`（`#edf1f7` 底 + `#d5dfec` 边 + `#475569` 字），版本号徽章固定采用等宽字体与 `#f6f8fb` 浅底；对账表内联状态条（`.status-pill`）前置 `6px` 同色圆点。

### Cards / Containers
零阴影、发丝边分割的阳极氧化铝层板体系，通过顶部 `2px` 光学轨标记当前工作焦点。
- **Corner Style:** `12px` 外圆角（`--radius-surface`），内部嵌套块（如身份条、附件盒、回执盒、链接栏）统一降级为 `8px` 圆角。
- **Background:** 主承载面为纯白 `#ffffff`，内嵌辅助区（`.inline-subform`、`.link-bar`、`.remind-grid`、`.identity-strip`）使用微凹浅灰 `#f6f8fb`，已签收电子回执盒（`.receipt-box`）使用 `#eaf8f1` 青绿浅底配 `#094a30` 深绿正文。
- **Shadow Strategy:** 严格执行零外部阴影法则（参见 Elevation & Depth）；仅原生 `<dialog class="picker-dialog">` 使用 `0 20px 48px rgba(15, 23, 42, 0.22)` 浮层阴影。
- **Border:** 外框与双舱中缝统一为 `1px solid #d5dfec`；激活层板附加 `.optical-surface` 伪元素顶轨（`height: 2px`，默认 `#1249d6`，完成态 `.optical-surface--emerald` 为 `#066a43`）。
- **Internal Padding:** 标准工作舱与双舱面板内边距为 `24px 28px`（`≤1040px` 为 `20px 22px`，`≤740px` 为 `18px 16px`）；员工确认单据 `.ack-sheet` 为 `30px 34px`（`≤740px` 为 `16px`）。

### Inputs / Fields
高对比描边表单控件，明确区分常规文本录入与等宽数据批量输入。
- **Style:** `8px` 圆角（`--radius-control`），`1px solid #b6c5d8` 强化描边，光标色统一设为 `#1249d6`。单行输入与下拉框最小高度 `40px`（内边距 `8px 12px`）；批量工号文本域（`.number-input`）默认置于 `#f6f8fb` 微凹槽底并使用等宽字体、`1.85` 行高，方便逐行核对工号。
- **Focus:** 悬停态边框加深至 `#8fa3bd`；聚焦态边框变为 `#1249d6`（批量工号框底色同时提亮为 `#ffffff`），并叠加 `2px solid #2563eb` 外轮廓（`outline-offset: 2px`）；组合搜索框（`.ledger-search`、`.picker-search`）通过 `:focus-within` 同步点亮外框与焦点环。
- **Error / Disabled:** 超出数量上限或校验失败时（`aria-invalid="true"`）边框切换为阻断绯红 `#a61b29`，并在下方配 `#a61b29` 文字说明；禁用态切换为 `#f6f8fb` 底色与 `#475569` 次级字色。

### Navigation
三套层级清晰的导航原语分别服务全局模块切换、工作舱模式切换与明细台账筛选：
- **深炭黑结构导轨（`.carbon-rail` / `.sheet-topbar`）**：管理端左侧 `256px` 导轨顶部放置 `32×32px` 品牌徽标框（顶边内嵌 `2px` `#3b82f6` 亮蓝微轨）；导航按钮（`10px 12px`，`8px` 圆角）默认 `#94a3b8` 文字，悬停升至 `#182234` 底与 `#f8fafc` 字，当前激活项锁定 `#1e2b42` 底、`1px solid #2e4263` 描边、`#ffffff` `600` 字重并在右侧点亮 `6px` `#60a5fa` 极性圆点。`≤880px` 折算为顶部横栏，`≤560px` 排布为 `2×2` 网格。
- **极性分段切换器（`.mode-tabs`）**：置于 `#edf1f7` 内嵌槽（`1px solid #d5dfec`、`8px` 圆角、`3px` 内边距）中的 `role="tablist"`，支持左右方向键与 `Home`/`End` 键盘漫游；激活项（`aria-selected="true"`）浮现纯白 `#ffffff` 底、`1px solid #b6c5d8` 描边与 `#1249d6` `600` 字重。
- **台账极性过滤标签（`.detail-tabs`）**：用于查询明细与五维对账分组切换，`6px` 圆角，前置 `6px` 状态圆点（默认 `#cbd5e1`，选中变为 `#1249d6`）与等宽数字计数；选中项呈现 `#edf3ff` 浅钴底、`#bfd2fc` 描边与 `#103cb3` 文字。

### Optical Split-Stream Bar (光学分束比例条)
定义全站视觉识别的签名组件（`.beam-panel`），置于管理端各核心视图首屏，将通讯录解析流向与实名签收对账进度转化为可交互的光学分束仪：
- **上部等宽读数阵列（`.beam-metrics`）**：按场景划分为 3 列、4 列或 5 列等分网格，节点间以 `1px solid #d5dfec` 竖线严密拼接（`13px 18px` 内边距）。上方主读数（`.beam-node-value`）采用 `1.25rem`、`650` 字重等宽制表数字，按语义着色为 `#0f172a`（基准总量）、`#1249d6`（在职匹配/进行中/新入职）、`#066a43`（有效邮箱/已实名确认）或 `#8a4206`（异常剔除/在职待确认）；当节点同时承担下方明细表过滤触发器时（`button.beam-node`），悬停泛起 `#f6f8fb` 浅底，激活态填充 `#edf3ff` 并点亮底部 `inset 0 -2px 0 #1249d6` 内嵌极性线。
- **下部零内联样式 SVG 分束轨（`.beam-track`）**：置于 `1px solid #d5dfec` 顶边分隔的 `#f6f8fb` 微凹槽内，内含 `viewBox="0 0 1000 6"`（高 `6px`、`2px` 圆角、`#edf1f7` 底槽）的自适应 SVG 条带。条段通过 SVG `x` 与 `width` 几何属性按 1000 单位坐标系精确切分（待命态钴蓝 `#1249d6`，有效/已确认段青绿 `#066a43`，异常/待确认段琥珀 `#d97706`，双色并存时预留 `6` 单位光学间隙），配合 `240ms cubic-bezier(0.16, 1, 0.3, 1)` 平滑过渡与下方 `0% / 50% / 100%` 等宽刻度尺；任务行与部门完成率单元格亦复用同源微缩分束条（`.task-mini-svg` `64×5px`、`.dept-meter-svg` `100×6px`）。

## Do's and Don'ts

### Do:
- **Do** 严格维持双壳层边界：管理路由（`/ops/*`）使用左侧 `256px` 深炭黑结构导轨与 `1220px` 画布，员工路由（`/ack/:slug`、`/my/acks`）使用无侧栏的 `748px` 净白单据壳层。
- **Do** 用舱顶 `2px` 实色光学导轨（`.optical-surface` 默认 `#1249d6`，完成/已签收态 `#066a43`）标记当前主焦点容器，并在同屏避免无关次级容器重复点亮顶轨。
- **Do** 将所有工号、企业邮箱、确认短链、令牌前缀与回执编号放入 `--font-mono` 等宽字体轨，并为一切统计数字、比例与时间戳开启 `tabular-nums`。
- **Do** 通过固定 `viewBox` 的 SVG `x`/`width` 属性驱动光学分束比例条与部门进度条，严格遵守零内联 `style` 属性与零外部资源引用的 CSP 约束。
- **Do** 确保所有语义状态（成功 `#066a43`、待办/异常 `#8a4206`、错误 `#a61b29`）同时具备中文文本、图标或极性点，并保持键盘 `:focus-visible` 的 `2px solid #2563eb` 焦点环清晰可见。

### Don't:
- **Don't** 为主画布上的工作舱、分束面板、表格或确认单据添加外部 `box-shadow` 投影，浮层阴影仅限原生 `<dialog>` 通讯录选择器使用。
- **Don't** 在员工确认单据页（`/ack/:slug`）暴露后台管理模块入口、全员通讯录统计或催办控件，确保普通员工阅读签署零干扰。
- **Don't** 在 JSX 或 SVG 元素上编写内联 `style={{ ... }}` 属性，或引入外部 Google Fonts / CDN 样式表破坏 `style-src 'self'` 安全策略。
- **Don't** 把双舱工作面拆成带间距的零散悬浮小卡片，也不要在主画布内使用深炭黑背景卡片或大字号流式 `clamp()` 装饰标题。
- **Don't** 仅凭红/黄/绿颜色变化表达对账或签收结果，也不要在企业邮箱缺失或人员离职时用模糊文案掩盖剔除原因。
