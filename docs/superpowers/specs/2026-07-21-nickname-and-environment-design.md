# 昵称词库与运行环境最小改造设计

日期：2026-07-21

## 目标

在不改变现有 FastAPI、Redis、SQLite 总体架构的前提下，解决两个实际问题：

1. Docker 部署后昵称词库退化，连续刷新容易看到重复候选。
2. Docker Compose 中 Redis 使用 DB 0，但 `APP_ENV` 默认是 `dev`，导致 Redis 和 SQLite 的环境标识不一致。

本次不引入 PostgreSQL、数据库控制 API、存储抽象层或新的前端框架。

## 现状

昵称格式为：

```text
<修饰 Token> + 的 + <身份 Token> + 鹅
```

`backend/nickname.py` 在本地优先读取 `words/THUOCL`。Dockerfile 没有复制该目录，因此镜像会使用仅包含 8 个成语和 4 个普通状态词的兜底数据。部署镜像当前统计为：

- 修饰词：8
- 普通状态词：4
- 精选梗词：78
- 理论组合空间：656

数据库已经按 `APP_ENV` 使用 `data/dev.db`、`data/prod.db` 或 `data/test.db`；`run.sh` 同时把 Redis 映射到 DB 1、0 或 2。Docker Compose 目前没有设置 `APP_ENV`，且固定连接 Redis DB 0，形成环境错配。

## 昵称设计

### 双 Token 分池

新增一个可随代码和 Docker 镜像发布的紧凑词库文件，例如 `backend/nickname_words.json`。运行时不再依赖被 `.gitignore` 排除的原始 `words/` 目录。

Token A 只保存能自然修饰“鹅”的短语：

- 60% 正向或幽默成语
- 25% 互联网动作状态
- 15% 技术气质短语

Token B 保存身份、状态或主题名词：

- 35% 互联网职场词
- 35% 程序员与 AI 词
- 20% 生活趣味词
- 10% 游戏彩蛋词

目标规模：

- Token A：至少 400 条
- Token B：至少 300 条
- 理论组合空间：至少 120,000

词库条目在加载时去空白、去重并检查长度。若词库文件缺失或格式错误，服务使用现有小型兜底池继续启动，并在日志中报告降级状态。

### 最近候选去重

昵称预览仍然不占用全局昵称。前端保存当前浏览器最近 30 个候选结果；新候选与近期结果重复时，最多自动重试 8 次。

正式确认昵称时继续使用 Redis `SETNX` 保证全服唯一。只有多次全局冲突后才追加随机后缀。

### 诊断信息

`/api/nickname/stats` 增加以下只读字段：

- `source`：`bundled` 或 `fallback`
- `modifier_tokens`
- `identity_tokens`
- `effective_combo_space`

诊断接口不返回具体完整词表。

## 环境与持久化设计

### 保留现有架构

- Redis：缓存、昵称占用、全服首发、排行榜和实时状态。
- SQLite：配方、元素、首发、昵称和积分的持久化归档。
- `reset.sh`：本地导出、恢复和清理工具。
- `/admin`：保持现有只读统计，不增加数据库写入或清理按钮。

### Docker Compose 修正

Compose 默认使用开发环境：

```text
APP_ENV=dev
REDIS_URL=redis://redis:6379/1
```

比赛部署通过私有 `.env` 覆盖为：

```text
APP_ENV=prod
REDIS_URL=redis://redis:6379/0
```

Web 服务挂载 `./data:/app/data`，保证 SQLite 文件在容器重建后仍然存在。Redis 继续挂载 `./data/redis:/data`。

更新 `.env.example`，只提供无密钥的开发默认值和生产配置说明。

### 启动校验

应用启动时仅做轻量检查：

- `APP_ENV` 必须是 `dev`、`prod` 或 `test`。
- 默认配置下，dev/test/prod 分别期望 Redis DB 1/2/0。
- 如果用户显式配置了其他 Redis 地址或 DB，可通过 `ALLOW_CUSTOM_REDIS_DB=1` 放行。
- 检测到明显错配时拒绝启动，避免调试数据写入正式环境。

不解析或打印 Redis 密码、Token、完整连接地址。

## 错误处理

- 昵称词库缺失：使用兜底词库，昵称功能继续可用。
- 最近候选连续冲突：返回最后一个合法候选，不阻塞用户。
- Redis 不可用：沿用现有启动失败行为，因为全服唯一和首发机制依赖 Redis。
- SQLite 目录不可写：启动失败并报告目录不可写，不静默使用临时目录。
- 环境配置错配：启动失败并给出变量名和期望 DB 编号，不输出凭据。

## 测试与验收

### 昵称

- 镜像内 `/api/nickname/stats` 显示 `source=bundled`。
- Token A 不少于 400 条，Token B 不少于 300 条。
- 固定随机种子后验证两类 Token 的权重落在允许误差内。
- 连续请求 1,000 个昵称，完整昵称重复率低于 1%。
- 浏览器连续刷新 30 次，不出现完整昵称重复。
- Redis 中已占用昵称不会再次分配给其他玩家。

### 环境

- 默认 Compose 启动后健康检查显示 `app_env=dev`，Redis 使用 DB 1，SQLite 使用 `dev.db`。
- prod 配置使用 Redis DB 0 和 `prod.db`。
- 故意配置 dev + DB 0 时启动失败。
- 容器重建后 SQLite 数据仍然存在。
- `reset.sh dev` 不影响 prod 数据。

### 回归

- 首页、首发墙、昵称确认、预设合成和排行榜接口正常。
- Python、JSON、Shell 与 Docker Compose 配置检查通过。

## 不在本次范围

- PostgreSQL 或其他云数据库迁移
- 公网数据库控制 API
- 数据库管理网页
- LLM 实时生成昵称
- 多地域或多集群数据同步
