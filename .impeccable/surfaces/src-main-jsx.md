---
version: 1
slug: "src-main-jsx"
primary_target: "src/main.jsx"
related_targets: ["src/styles.css","src/views/MailView.jsx","src/views/TasksView.jsx","src/views/ProjectsView.jsx","src/views/TokensView.jsx","src/views/AckView.jsx"]
---

# 飞书运营助手 · 全套工作台与实名确认单据页

- **Mode**: Operate（管理端 `/ops/mail`、`/ops/tasks`、`/ops/projects`、`/ops/admin`）与 Operate/Read（员工端 `/ack/:slug`、`/my/acks`）。
- **Audience & Job**: 企业运营/行政管理员在明亮桌面或飞书内高效提取在职企业邮箱、对账文件签收并双通道催办；全体员工从邮件或飞书点击确认链接完成本人实名签收并留存电子回执。
- **Constraints**: 严格遵守 `Content-Security-Policy`（`default-src 'self'`、`style-src 'self'`），零外部 CDN 与零内联 `style` 属性；保留全部路由、API 与状态逻辑。

## Direction contract

THESIS: 以高端硬件级「阳极氧化铝光学分束工作台」重构企业通讯录提取与文件实名签收对账，拒绝松散的传统后台圆角卡片堆叠、霓虹炫光与大数字看板模板。

OWN-WORLD: 微冷铝银底板 `#EEF2F7` 承载纯白 `1px` 发丝边（`#D5DFEC`）层板，左侧立式深炭黑结构导轨 `#111827` 收拢管理模块与身份状态；激光钴蓝 `#1D5EFF` 专司主动作、激活舱顶 `2px` 光学聚焦轨与选中极性，配核准青绿 `#067647` 与异动琥珀 `#B45309`；单一中文无衬线固定 `rem` 字阶，所有工号、邮箱、哈希、回执与计数归入等宽制表数字轨。

STORY: 管理员进入工作台即通过「光学分束比例条」看清输入源、在职匹配、有效输出或已签/待签/离职冲销的精确分流，无缝完成提取发信、创建任务与催办；普通员工打开 `/ack/:slug` 进入无后台导航干扰的净白光学核验单据，核对身份与版本后一键确认并获得结构化电子回执。

FIRST VIEWPORT: 桌面管理端左侧固定 `228px` 深炭黑模块导航轨（移动端折叠为紧凑顶栏），右侧主画布顶置标题与实时「光学分束比例条」，下方紧接带激活顶轨的零阴影双舱工作面或高密度对账台账，主操作按钮锚定于激活舱底部或页头右侧；员工单据页居中呈现 `680px` 独立核验单据，首屏直达标题版本、本人飞书实名通行条与确认主按钮。

FORM: 阳极氧化铝光学分束舱（Anodized Aluminum & Optical Split-Stream Bay），Re-roll Round 1 候选列表第 1 位（`IMPECCABLE’S PICK`），`seed:3d3c3f9997d2365d`。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
