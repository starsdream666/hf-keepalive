# HF Space 保活

基于 Cloudflare Workers + Static Assets 的 HuggingFace Spaces 保活工具，带前端管理面板。

## 功能

- 添加 / 编辑 / 删除多个 HuggingFace Space
- 为每个 Space 独立设置保活间隔（分钟级）、启用开关、autoRestart
- 每分钟由 Cron 扫描，按 interval 触发 HTTP GET 保活
- 检测到 Space 已休眠 / 停止时，自动调用 HF Restart API（需 write token）
- 单密码登录，HMAC 签名 cookie 维持会话
- 每个 Space 保留最近 50 条保活历史，可在 UI 中查看

## 技术栈

- Cloudflare Workers（fetch + scheduled handler）
- Cloudflare KV（空间配置、日志、限流）
- Workers Static Assets（托管单文件前端）
- Tailwind CSS via CDN + vanilla JS（无构建步骤）

## 部署

提供两种部署方式，选一种即可：

| 方案 | 适合谁 | 关键步骤 |
| --- | --- | --- |
| **方案 A：Cloudflare Dashboard 手动部署** | 不想装 wrangler / Node 的用户 | 推 GitHub → Dashboard 连接仓库 → 自动构建 |
| **方案 B：wrangler CLI 部署** | 熟悉命令行的开发者 | `wrangler deploy` 一行命令 |

---

### 方案 A：Cloudflare Dashboard 手动部署（推荐网页操作）

通过 Cloudflare 的 **Workers Builds（Git 集成）** 实现：在 Dashboard 里把 Worker 关联到 GitHub 仓库，每次 `git push` 自动构建并部署。整个流程几乎不需要本地命令行。

#### A1. 把项目推到 GitHub

> ⚠️ 当前项目所在目录名 `新建文件夹 (4)` 含中文和空格，**强烈建议先复制到一个英文名目录**（如 `hf-keepalive`）再推送，避免 Git / CF 构建路径出现编码问题。

1. 在 GitHub 上新建一个空仓库，例如 `hf-keepalive`（公开或私有均可）。
2. 在本机把项目目录（含 `wrangler.toml`、`src/`、`public/`、`package.json`、`tsconfig.json` 等）推到该仓库。如果你不熟 Git，可以直接在 GitHub 网页上点击 **Add file → Upload files**，把这些文件全部拖进去后提交。

#### A2. 在 Dashboard 创建 KV namespace

1. 打开 [https://dash.cloudflare.com](https://dash.cloudflare.com)，左侧菜单选 **Storage & Databases → KV**（或 **Workers & Pages → KV**，不同账户可能位置不同）。
2. 点击 **Create instance / Create a namespace**，名称填 `hf-keepalive-kv`，确认创建。
3. 创建后会看到一行：`hf-keepalive-kv` + 一串 32 位十六进制 ID。**复制这个 ID**。
4. 回到你 GitHub 仓库的 `wrangler.toml`，把：

   ```toml
   [[kv_namespaces]]
   binding = "KV"
   id = "REPLACE_WITH_KV_NAMESPACE_ID"
   ```

   中的 `REPLACE_WITH_KV_NAMESPACE_ID` 替换为刚才那串 ID，提交推送。

   > 在 GitHub 网页可以直接点 `wrangler.toml` → 铅笔图标编辑 → 改完点 Commit changes。

#### A3. 在 Dashboard 创建 Worker 并连接仓库

1. Dashboard → **Workers & Pages → Create application**。
2. 选 **Import a repository**（如果是首次，需先 **Connect GitHub** 授权 Cloudflare Workers & Pages GitHub App，并把你那个仓库加入授权列表）。
3. 在仓库列表中点选 `hf-keepalive` → **Begin setup**。
4. 项目配置：
   - **Project name**：`hf-keepalive`（决定最终 URL）
   - **Production branch**：`main` 或 `master`（按你的仓库实际情况）
   - **Build command**：留空（wrangler 会自动检测 `src/index.ts`）
   - **Deploy command**：默认 `npx wrangler deploy` 即可
   - **Root directory**：保持 `/`
5. 点击 **Save and Deploy**，Cloudflare 会开始构建：拉代码 → 安装依赖 → `wrangler deploy`。等待 1-3 分钟。

> 第一次部署可能因为 KV namespace ID 还未填或 Secret 还没设置而失败。**这是正常的，先继续 A4 配置 Secret，然后回来重新触发部署**。

#### A4. 在 Dashboard 配置 Secret

部署后回到该 Worker 详情页：

1. 进入 **Settings → Variables and Secrets**（不同账户也可能叫 **Settings → Bindings & Variables**）。
2. 点 **Add → Secret**，添加：
   - **Variable name**：`ADMIN_PASSWORD`
   - **Value**：你想用来登录面板的密码
   - 点 **Save and deploy**
3. 再添加一条 Secret：
   - **Variable name**：`SESSION_SECRET`
   - **Value**：32 字节以上的随机字符串，用于 cookie 签名。
     - 可以在浏览器控制台用 `crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),'')` 生成
     - 或访问 [random.org/strings](https://www.random.org/strings/) 取一段 64 字符的十六进制
4. 两个 Secret 加完后，CF 会自动触发一次重新部署。

#### A5. 验证 KV 与 Cron 绑定

回到 Worker 详情页：

- **Settings → Bindings**：应当看到一条 `KV` 绑定（变量名 `KV`，指向你创建的 `hf-keepalive-kv` namespace）。如果没有，手动 **Add → KV namespace**：变量名 `KV`，选择刚才那个 namespace，保存。
- **Settings → Triggers** 或 **Triggers → Cron Triggers**：应当看到 `* * * * *`，每分钟触发。这是 `wrangler.toml` 中 `[triggers]` 自动同步过来的。

如果发现没自动同步，可以手动 **Add Cron Trigger**，表达式填 `* * * * *`。

#### A6. 访问与登录

部署完成后，Worker 详情页顶部会显示 URL（形如 `https://hf-keepalive.<your-account>.workers.dev`）。在浏览器打开，输入第 A4 步设置的 `ADMIN_PASSWORD` 即可登录。

#### A7. 后续更新

之后只要在 GitHub 仓库 `git push`（或在网页编辑提交），Cloudflare 就会自动重新构建部署。日志可在 Worker 详情页 → **Deployments** 查看。

---

### 方案 B：wrangler CLI 部署

适合本机已装 Node.js / 熟悉命令行的用户。

#### B1. 安装依赖

```bash
npm install
```

#### B2. 创建 KV namespace

```bash
npx wrangler kv namespace create KV
```

把命令输出的 `id` 填入 [wrangler.toml](wrangler.toml) 中 `kv_namespaces` 块的 `id`。

#### B3. 设置 Secret

```bash
# 登录密码
npx wrangler secret put ADMIN_PASSWORD

# 会话签名密钥 —— 建议用 openssl 生成
# 在 PowerShell 中可用： [Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))
# 或 Bash:  openssl rand -base64 32
npx wrangler secret put SESSION_SECRET
```

#### B4. 部署

```bash
npx wrangler deploy
```

部署后访问 `https://hf-keepalive.<account>.workers.dev/`，用 `ADMIN_PASSWORD` 登录。

## 本地开发

```bash
npx wrangler dev
```

默认在 `http://localhost:8787` 运行。手动触发 cron：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

> 本地 dev 模式下，`wrangler secret put` 设置的 Secret 不会注入。请在项目根创建 `.dev.vars`：
> ```
> ADMIN_PASSWORD=test123
> SESSION_SECRET=dev_secret_at_least_32_chars_long
> ```

## 使用

1. 登录后点击右下角 `+` 添加 Space，URL 支持三种格式：
   - 完整 `https://user-space.hf.space`
   - 仓库路径 `user/space`
   - HF 页面 `https://huggingface.co/spaces/user/space`
2. 设置保活间隔（建议 5-30 分钟，HF 免费 Space 实际 48h 才 sleep）。
3. 如需自动 restart 功能，在「设置」中填入 HuggingFace Token（需 write 权限）。
4. 点击空间卡片上的「立即保活」可手动触发，结果会立即反映在卡片状态。
5. 「日志」按钮查看该 Space 的最近 50 条保活历史。

## 限制

- Cloudflare Workers 免费版每次 scheduled 调用最多 50 个 subrequest。本工具每个 Space 最多消耗 2 个 subrequest（GET + 可能的 runtime 查询或 restart），单次 scheduled 最多并行处理 ~25 个 Space。
- Cron 最小粒度 1 分钟，所以保活间隔下限 1 分钟。
- KV 写入有最终一致性，UI 刚保存的修改可能在另一个边缘节点上略有延迟。
- 免费 `cpu-basic` 硬件 sleep 时间固定 48 小时，不可通过 API 配置。本工具的作用是在 48h 临近前主动 ping 保活。

## 目录

```
.
├── wrangler.toml         # Workers 配置
├── package.json
├── tsconfig.json
├── public/
│   └── index.html        # 单文件前端
└── src/
    ├── index.ts          # fetch / scheduled 入口
    ├── router.ts         # API 路由分发
    ├── auth.ts           # HMAC cookie 认证
    ├── kv.ts             # KV 读写封装
    ├── keepalive.ts      # 单 Space 保活动作
    ├── scheduler.ts      # cron 调度
    ├── hf.ts             # HuggingFace API
    ├── utils.ts          # URL 归一化等
    └── types.ts          # 类型定义
```
