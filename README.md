# 飞书运营助手（Feishu Ops Helper）

基于同一飞书企业自建应用的内部运营平台，将 **企业邮箱提取（邮件助手）** 与 **重要文件分发确认及全员对账** 统一在同一套飞书身份、权限与通讯录命名空间下（React 19 + Node.js 22 原生 `node:sqlite`）。

## 核心功能模块

1. **邮箱提取（`/ops/mail`）**
   - 支持**按工号列表**或**原生通讯录选择成员 / 部门**提取在职同事 `enterprise_email`（空格分隔、去重、自动剔除离职与冻结成员）。
   - 支持点击 **「以此范围新建确认任务」** 一键将同一批收件受众转入文件分发确认任务，无需二次选人。
2. **分发确认与通讯录对账（`/ops/tasks`、`/ops/tasks/:slug`）**
   - 新建任务自动生成员工专属确认链接 `/ack/:slug` 与标准邮件通知正文，支持填写飞书云文档链接、随信附件名及 `SHA-256` 校验摘要。
   - **发布快照 + 实时通讯录五维对账**：自动对比全员或指定范围在职通讯录，区分「已确认」「在职待确认」「发布后新入职（支持一键纳入）」「已离职/冻结自动移出分母」「范围外转发确认」及各部门完成率。
   - **双通道催办**：支持一键复制全部未确认在职同事邮箱补发提醒邮件，或通过同一飞书机器人接口（`POST /im/v1/messages`）定向推送交互式催办卡片（覆盖未配置企业邮箱的同事）。
   - 支持**发布新版本重签**（保留旧版历史回执）与防公式注入的 **UTF-8 CSV 台账导出**。
3. **员工邮件确认单据页（`/ack/:slug`、`/my/acks`）**
   - 独立无后台干扰的 720px 单据界面：员工从外部邮件客户端点击链接时自动走飞书网页 OAuth 2.0 授权登录；在飞书客户端或催办卡片内点击时自动走 H5 JSSDK 免登。
   - 展示实名身份条（姓名 + 工号 + 部门）、必读说明与附件校验信息，勾选确认后生成唯一电子回执编号（如 `ACK-20261123-XXXXXX`）。
4. **命名空间与权限同步（`/ops/permissions`）**
   - 共享同一 `FEISHU_APP_ID`、通讯录缓存与两级角色控制（全体本企业员工可访问 `/ack/:slug` 实名签收；仅管理员与授权协作者可进入 `/ops/*` 管理工作台）。

## 本地快速体验（演示模式）

要求 **Node.js >= 22.12.0**。

```bash
npm install
cp .env.example .env
npm run dev
```

打开 **http://localhost:5173**（默认 `APP_MODE=demo`）：
- 右上角可随时切换 **「运营管理员 · 林晓」「待确认员工 · 陈予」「已确认员工 · 许言」「期间新入职员工 · 沈禾」** 四个视角，完整体验「提取收件邮箱 → 一键转入新建任务 → 员工点邮件链接实名签收 → 管理员通讯录增量对账与卡片催办」全链路。

## 接入真实飞书开放平台配置清单

1. **创建企业自建应用**
   - 在 [飞书开发者后台](https://open.feishu.cn/app) 启用 **网页应用** 与 **机器人**（如需卡片催办）能力。
2. **配置应用权限（Scopes）与通讯录数据范围**
   - 通讯录只读权限：`contact:contact.base:readonly`、`contact:user.base:readonly`、`contact:user.employee:readonly`、`contact:user.employee_id:readonly`。
   - 飞书机器人催办卡片权限（可选）：`im:message:send_as_bot`。
   - 在「权限管理 → 通讯录权限范围」配置允许对账的部门或全员范围，并发布版本审核生效。
3. **配置安全域名与网页 OAuth 重定向 URL**
   - H5 安全域名填写部署来源（与 `APP_ORIGIN` 一致，例如 `https://ops.example.com`）。
   - **安全设置 → 重定向 URL** 必须添加：
     - `${APP_ORIGIN}/api/auth/oauth/callback`（供员工在邮件客户端点击外部浏览器链接时完成飞书 OAuth 登录回跳）
     - 应用工作台入口地址（供飞书端内 `requestAccess` 免登使用）
4. **生产环境变量与启动**
   - 参考 [`.env.example`](.env.example) 配置 `APP_MODE=feishu`、`APP_ORIGIN`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`DB_PATH=./data/ops-helper.sqlite` 及 `ADMIN_EMPLOYEE_NOS` / `ADMIN_OPEN_IDS`。
   - 构建与启动：
     ```bash
     npm run build
     npm start
     ```

## 测试与构建验证

```bash
npm test
npm run build
```
