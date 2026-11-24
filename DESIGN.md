---
name: 飞书运营助手
description: 集通讯录邮箱提取与重要文件实名确认对账于一体的企业运营工具
colors:
  navy: "#153e63"
  primary: "#245fc7"
  primary-hover: "#174da9"
  page: "#f2f5f8"
  surface: "#ffffff"
  text: "#1f3447"
  muted: "#607185"
  line: "#dce4ec"
  tint: "#edf3fb"
  success: "#22664e"
  success-bg: "#eaf5f0"
  warning: "#845119"
  warning-bg: "#fff5e8"
  error: "#ab3434"
  error-bg: "#fcecec"
  placeholder: "#586d83"
  summary-text: "#3f586d"
  summary-background: "#edf4f3"
  output-background: "#f7f9fc"
  focus: "#4d7dc6"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "clamp(24px, 2.2vw, 30px)"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: "-0.03em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "14px"
    fontWeight: 1.7
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "12px"
    lineHeight: 1.8
  data:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "13px"
    lineHeight: 1.85
rounded:
  chip: "5px"
  control: "6px"
  input: "7px"
  notice: "8px"
  surface: "12px"
spacing:
  compact: "8px"
  control: "16px"
  section: "24px"
  wide: "32px"
---

# Design System: 飞书运营助手

## Overview

**Creative North Star: "运营索引与签收台账"**

延续飞书邮箱助手确立的办公清单视觉语言：深海蓝页头建立统一应用识别，浅蓝灰页面底色与纯白描边工作面承载高密度通讯录与回执数据。所有视觉元素服从表单录入、标签过滤、名册核对与回执留痕，不引入装饰性卡片堆叠、渐变或阴影噪音。

## Two-Surface Architecture

1. **运营工作台（Operate · `/ops/mail` & `/ops/tasks`）**
   - 顶部深海蓝 `topbar` 内嵌平级模块切换（`邮箱提取` / `分发确认`），保持 1240px 最大内容宽度。
   - `邮箱提取`：左右双区（1 : 1.1），左侧切换工号/成员部门输入，右侧呈现汇总条、空格分隔邮箱框、一键复制与「以此受众新建确认任务」联动入口。
   - `分发确认`：任务名册与对账详情双视图。对账详情沿用签名汇总条（`应确认 › 已确认 › 待确认`），集中提供「未确认人员邮箱一键复制」与「飞书机器人卡片催办」双出口，下方以标准标签页切换 `待确认`、`已确认`、`期间新入职`、`已离职剔除` 与 `部门进度`。
2. **员工确认单据页（Operate/Read · `/ack/:slug`）**
   - 面向从企业邮件点击链接进入的全体员工，移除后台模块切换干扰，居中采用 680px 单据版式。
   - 清晰分层呈现：任务标题与版本号、必读说明正文、关联飞书云文档/附件 SHA-256 核对信息、当前飞书登录人的实名身份条（姓名 · 工号 · 部门），以及单一明确的确认主按钮或绿色已签收电子回执凭证。

## Colors & Contrast

- 深海蓝 `#153e63` 专用于顶部栏；办公蓝 `#245fc7` 用于主操作、选中态与链接。
- 状态语义必须同时包含文字、图标与颜色：成功签收 `#22664e`（配浅底 `#eaf5f0`）、待确认/异动提示 `#845119`（配 `#fff5e8`）、错误告警 `#ab3434`（配 `#fcecec`）。
- 占位文字 `#586d83` 与所有次级说明在白底及浅底容器上保持 ≥ 4.5:1 对比度；键盘焦点统一采用 `3px solid #4d7dc6` 外轮廓。

## Typography & Data Formatting

- 正文与标题使用中文系统无衬线字体栈；工号、企业邮箱、确认链接、回执编号及文件 SHA-256 校验值统一使用等宽字体栈。
- 所有计数、百分比、时间戳开启 `font-variant-numeric: tabular-nums` 保证上下行纵向对齐。

## Elevation & Responsive Rules

- 主工作面仅通过 `1px solid #dce4ec` 描边和底色区分层级，无阴影；仅模态对话框（演示通讯录选择器）使用遮罩与浮层阴影。
- 1000px 以下收紧内边距；740px 以下双列工作区自动堆叠为单列，邮件手机端打开 `/ack/:slug` 时按钮与身份栏保持全宽易点按。
