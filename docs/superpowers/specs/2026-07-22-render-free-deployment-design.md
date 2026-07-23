# Render 免费部署设计

## 目标

让玩家通过 Render 提供的公开 HTTPS 链接直接游玩，无需下载仓库或安装本地环境。

## 架构

Render 使用仓库根目录的 Dockerfile 构建并运行单个 FastAPI Web Service。Web Service 同时提供前端静态文件和 API，并通过用户在 Render 创建的免费 Key Value 实例访问 Redis；服务端使用秘密环境变量访问 DeepSeek 官方 API。

## 配置边界

- 仓库声明 Docker Web Service、免费实例、健康检查和非敏感默认值。
- `LLM_API_KEY` 与 `REDIS_URL` 只在 Render Dashboard 填写，不提交到 Git。
- 容器监听 `0.0.0.0` 和 Render 注入的 `PORT`，本地未提供时回退到 `8000`。
- 免费 Render 文件系统是临时的，SQLite 动态归档可能在休眠、重启或重新部署后丢失；此阶段接受该限制。

## 验收标准

- Docker 容器支持动态 `PORT`。
- `render.yaml` 能创建 Docker Web Service，并将秘密变量标记为手动同步。
- Render 使用 `/api/health` 检查服务。
- README 包含从创建 Redis 到获得公开链接的完整操作步骤。
- `.env` 保持被 Git 忽略。
