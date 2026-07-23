# EdgeOne Makers 团队开发指南

EdgeOne Makers 是本项目当前的默认开发和生产平台。本指南用于成员从 GitHub
克隆仓库后，在自己的电脑上运行静态页面、Edge Functions、Makers KV 和
Makers Models。

## 运行结构

同一个 Makers 项目绑定了两个相互隔离的 KV 命名空间：

| 环境 | `APP_ENV` | Edge Function 全局变量 | 命名空间 |
| --- | --- | --- | --- |
| 本地开发 | `dev` | `test_dev` | `infinite_craft_dev` |
| `main` 生产发布 | 留空、`makers` 或 `prod` | `test` | `infinite_craft` |

本地 Makers 开发会连接远端的 `infinite_craft_dev`，并不是在电脑上模拟一套
内存 KV。旧 FastAPI 使用的 Redis 和 `data/*.db` SQLite 文件不参与 Makers
运行，也不会与两个 KV 命名空间自动同步。

## 前置条件

- Node.js 20 或更高版本。
- EdgeOne CLI 1.6.7 或更高版本。
- 成员的腾讯云账号已经获得现有 Infinity Makers 项目的访问权限。
- 项目控制台保持以下 KV 绑定：
  - `test_dev → infinite_craft_dev`
  - `test → infinite_craft`
- 项目控制台已经配置 `MAKERS_MODELS_KEY` 或
  `AI_GATEWAY_API_KEY`。

不要在共享的 Makers 控制台环境变量中设置 `APP_ENV=dev`。Makers 项目环境
变量对所有部署统一生效，这会让后续生产部署也选择开发 KV。

## 首次克隆与关联

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
npm install
npm install -g edgeone
edgeone -v
edgeone login --site china
edgeone makers link
```

`edgeone makers link` 会显示项目选择器。请选择团队已经在使用、并具有上述两个
KV 绑定的现有项目，不要创建同名新项目。关联完成后：

- `.edgeone/project.json` 保存成员本机的项目关联。
- `.env` 保存从 Makers 同步的项目环境变量。
- 两者均被 `.gitignore` 排除，不能提交。

如果项目已经关联，但本机没有 `.env`，执行：

```bash
edgeone makers env pull -f .env
```

不要在终端、聊天或 Issue 中粘贴 `.env` 内容。

## 启动本地 Makers

```bash
npm run makers:dev
```

该命令会：

1. 检查 `.edgeone/project.json` 和 `.env`。
2. 只把本机 `.env` 中的 `APP_ENV` 设置为 `dev`，保留其他配置和密钥。
3. 运行 `edgeone makers dev --skip-env-sync`。
4. 让 Edge Function 只使用 `test_dev → infinite_craft_dev`。

打开 CLI 输出的 HTTP 地址。默认通常为：

```text
http://127.0.0.1:8088/
```

必须通过 Makers 的 HTTP 开发服务器访问。不要直接打开 `frontend/index.html`
形成 `file://` 地址，也不要使用 `python -m http.server`、`npx serve` 等普通
静态服务器；这些方式不会运行 Edge Functions，也不能正确注入 KV 和环境变量。

## 本地验证

先检查健康状态：

```bash
curl --noproxy '*' http://127.0.0.1:8088/api/health
```

预期至少包含：

```json
{
  "kv": "ok",
  "app_env": "dev",
  "llm": "configured"
}
```

然后打开游戏，合成一组固定配方之外的元素。首次请求应通过 Makers Models
生成结果并写入 `infinite_craft_dev`；重复相同组合应直接命中开发 KV 缓存。

其他只读检查：

```bash
curl --noproxy '*' http://127.0.0.1:8088/api/elements
curl --noproxy '*' \
  'http://127.0.0.1:8088/api/wall/page?offset=0&limit=1'
```

## 日常开发

```bash
git pull --ff-only
npm install
npm test
npm run makers:dev
```

修改完成后运行：

```bash
npm test
npm run build
npm run makers:build
```

将代码推送到功能分支可用于代码审查；合并或直接推送 `main` 后，现有 Makers
Git 集成会自动创建新的生产部署。生产请求未设置 `APP_ENV=dev`，因此继续使用
`test → infinite_craft`。

## Git 中的配置边界

会提交：

- `edgeone.json`
- `package.json` 中的 Makers 构建、测试和开发命令
- `.env.example`
- `scripts/dev-makers.mjs`
- KV 绑定名称、命名空间约定和本指南

不会提交：

- `.env` 与任何真实模型密钥、`ADMIN_TOKEN`
- `.edgeone/` 项目关联和登录状态
- Makers API Token
- 带 `eo_token` / `eo_time` 的临时预览链接
- KV 导出、SQLite、Redis AOF/RDB 或玩家数据

## 常见问题

### 提示先运行 `edgeone makers link`

当前克隆尚未关联项目。登录正确账号后执行：

```bash
edgeone makers link
```

选择已有项目，不要创建新项目。

### 提示先运行 `edgeone makers env pull -f .env`

项目已关联，但本机环境变量文件不存在：

```bash
edgeone makers env pull -f .env
npm run makers:dev
```

### 提示缺少 `test_dev`

检查 Makers 控制台当前项目的 KV 绑定是否为：

```text
test_dev → infinite_craft_dev
```

变量名必须完全一致，不要把命名空间名称直接写进代码。

### 健康检查显示 `llm: "not_configured"`

在 Makers 项目环境变量中配置 `MAKERS_MODELS_KEY`，然后重新执行
`edgeone makers env pull -f .env`。`/api/health` 只证明密钥已加载；还应实际
合成一次未知组合验证模型调用。

### 需要一个云端开发部署

当前 Makers 项目的环境变量对所有部署统一生效，不能安全地让同一项目的生产
部署和云端开发部署长期使用不同 `APP_ENV`。如果将来需要持续存在的云端开发
地址，应创建独立 Makers 开发项目，并只在该项目绑定
`test_dev → infinite_craft_dev`。本指南当前覆盖成员电脑上的 Makers 本地开发。

## Legacy FastAPI 与 Render

`./run.sh`、Docker Compose、Redis、SQLite 和 Python 后端仍可用于离线分析或
传统服务器备用运行，但不是当前团队默认链路。

Render 当前暂停使用，历史 Blueprint 位于
`deploy/legacy/render.yaml`。仓库无法自动暂停 Render 控制台中已经存在的
服务；项目所有者需要在 Render 控制台手动暂停服务或关闭自动部署。
