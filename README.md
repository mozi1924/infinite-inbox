# Infinite Inbox 📥

Infinite Inbox 是一个基于 Cloudflare 生态系统（Workers, D1, Durable Objects）构建的现代化临时邮箱服务。它提供了实时邮件接收、多域名支持以及优雅的用户界面。

## ✨ 特性

- **实时通知**: 使用 Cloudflare Durable Objects 和 WebSocket 实现邮件秒级到达提醒。
- **持久化存储**: 使用 Cloudflare D1 存储邮件内容，安全可靠。
- **静态资源托管**: 前端应用直接部署在 Cloudflare Workers 上，无需额外托管。
- **响应式设计**: 使用 React + MUI 构建的现代化 UI，适配各种设备。
- **基础鉴权**: 通过环境变量中的 API Key 登录，并将登录状态保存在 HttpOnly Cookie 中。

## 🛠️ 技术栈

- **Frontend**: React, Material UI, Vite, TypeScript
- **Backend**: Cloudflare Workers, Hono
- **Database**: Cloudflare D1 (SQLite)
- **Real-time**: Cloudflare Durable Objects (WebSockets)
- **Email**: Cloudflare Email Routing

---

## 🚀 部署教程

按照以下步骤，您可以快速部署自己的 Infinite Inbox 实例。

### 0. 准备工作

确保您已安装 [Node.js](https://nodejs.org/) (推荐 v18+) 并且拥有一个 [Cloudflare](https://dash.cloudflare.com/) 账户。

### 1. 编译前端应用

首先需要将 React 前端代码编译为静态资源：

```bash
# 进入前端目录
cd app

# 安装依赖
npm install

# 编译代码
npm run build

# 回到根目录
cd ..
```

编译完成后，静态文件将保存在 `app/dist` 目录中。

### 2. 创建并配置数据库

使用 Wrangler 创建 Cloudflare D1 数据库，并应用数据表结构。

```bash
# 进入 worker 目录
cd worker

# 创建 D1 数据库
npx wrangler d1 create infinite-inbox-db
```

运行上述命令后，终端会输出类似以下的信息：

```toml
[[d1_databases]]
binding = "DB"
database_name = "infinite-inbox-db"
database_id = "xxxx-xxxx-xxxx-xxxx"
```

**请复制 `database_id` 的值，稍后需要填入 `wrangler.toml`。**

接下来，将数据库架构应用到远程数据库：

```bash
# 应用 schema.sql 到远程数据库
npx wrangler d1 execute infinite-inbox-db --remote --file=./schema.sql
```

### 3. 配置 `worker/wrangler.toml` 与密钥环境变量

打开 `worker/wrangler.toml` 文件，确保以下部分已正确填入：

```toml
name = "infinite-inbox"
main = "src/index.ts"
compatibility_date = "2024-03-20"
compatibility_flags = [ "nodejs_compat" ]

[assets]
directory = "../app/dist" # 指向第 1 步生成的编译目录

[[d1_databases]]
binding = "DB"
database_name = "infinite-inbox-db"
database_id = "在这里填入您在第 2 步获取的 ID"

[durable_objects]
bindings = [{ name = "INBOX_STATE", class_name = "WebSocketBroadcaster" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["WebSocketBroadcaster"]
```

然后为 Worker 配置 API 密钥与允许访问的前端来源：

```bash
# 在 worker 目录下设置 API 密钥（生产环境）
npx wrangler secret put API_KEY

# 可选：设置允许跨域携带 Cookie 的前端来源，例如 https://mail.example.com
npx wrangler secret put ALLOWED_ORIGIN
```

说明：

- `API_KEY` 是登录页面需要输入的密钥。
- `ALLOWED_ORIGIN` 建议设置为您的前端正式域名，未匹配来源的跨站请求会被拒绝。
- 登录成功后，系统会将密钥保存到 `HttpOnly + SameSite=Strict` Cookie，前端脚本无法直接读取。

### 4. 上传并部署

一切就绪后，将应用部署到 Cloudflare：

```bash
# 在 worker 目录下执行
npx wrangler deploy
```

部署成功后，您将获得一个类似 `https://infinite-inbox.your-subdomain.workers.dev` 的访问地址。

### 5. 配置邮件路由 (Email Routing)

为了让 Worker 能够接收邮件，您需要在 Cloudflare 控制面板中进行配置：

1. 登录 Cloudflare 仪表板，选择您的域名。
2. 进入 **Email -> Email Routing**。
3. 如果尚未启用，请按提示启用它（配置 MX 记录等）。
4. 进入 **Routing Rules** 选项卡。
5. 在 **Catch-all address** 中，选择 **Edit**，然后将 **Action** 设置为 **Send to Worker**，并将 **Worker** 设置为刚刚部署的 `infinite-inbox`。

现在，发送到该域名任何地址的邮件都会自动出现在您的 Infinite Inbox 中。

---

## 🔐 鉴权与安全说明

系统现在包含以下基础安全措施：

- 所有 `/api/*` 接口默认都需要有效登录态，只有 `/api/auth/login`、`/api/auth/logout`、`/api/auth/session` 允许匿名访问。
- 登录校验使用服务端环境变量中的 `API_KEY`，避免把密钥硬编码进前端。
- 登录成功后通过 `HttpOnly Cookie` 持久化会话，降低前端脚本窃取密钥的风险。
- Cookie 设置为 `SameSite=Strict`，用于缓解常见跨站请求伪造风险。
- 接口对请求来源进行白名单校验，仅允许 `ALLOWED_ORIGIN` 指定的来源跨域访问并携带凭据。
- 所有数据库查询都使用参数绑定，避免 SQL 注入。
- API 响应附带 `X-Frame-Options`、`X-Content-Type-Options`、`Cross-Origin-Opener-Policy` 等安全响应头。

---

## 💻 本地开发

如果您想在本地运行以便调试：

```bash
# 在 app 目录启动前端开发服务器
cd app
npm run dev

# 在 worker 目录启动本地开发环境
cd worker
npx wrangler dev
```

本地调试时建议额外配置：

- 本地 Worker 设置 `API_KEY`
- 本地 Worker 设置 `ALLOWED_ORIGIN=http://localhost:5173`
- 前端通过 `credentials: "include"` 自动携带 Cookie 访问 Worker

## 📝 许可证

MIT License
