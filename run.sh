#!/usr/bin/env bash
# Infinity Craft · 鹅厂打工人版 —— 本地一键启动
# - 自动拉起独立 Redis 容器（ic-redis，AOF 持久化）
# - 激活 conda 环境 craft（若不存在则自动创建）
# - 启动 FastAPI
set -euo pipefail

cd "$(dirname "$0")"

# ------------------------------------------------------------
# 1) Redis（Docker 容器）
# ------------------------------------------------------------
REDIS_CONTAINER="ic-redis"
REDIS_PORT="${REDIS_PORT:-16739}"   # 冷门端口防冲突

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 找不到 docker。请先安装 Docker。"
  exit 1
fi

ensure_redis() {
  if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
    echo "✅ Redis 已运行 (${REDIS_CONTAINER})"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
    echo "🔄 启动已存在的 Redis 容器..."
    docker start "${REDIS_CONTAINER}" >/dev/null
    return
  fi
  echo "🚀 首次拉起 Redis 容器（AOF 持久化，挂载 ./data/redis）..."
  mkdir -p ./data/redis
  docker run -d \
    --name "${REDIS_CONTAINER}" \
    --restart unless-stopped \
    -p "127.0.0.1:${REDIS_PORT}:6379" \
    -v "$(pwd)/data/redis:/data" \
    redis:7-alpine \
      redis-server \
        --appendonly yes \
        --appendfsync everysec \
        --save 900 1 --save 300 10 \
        --dir /data >/dev/null
  echo "✅ Redis 已起 (localhost:${REDIS_PORT})"
}

ensure_redis

# ------------------------------------------------------------
# 2) Conda 环境 craft
# ------------------------------------------------------------
CONDA_ENV="${CONDA_ENV:-craft}"
PY_VERSION="${PY_VERSION:-3.11}"

# 找到 conda 安装目录（按常见位置依次尝试）
find_conda_base() {
  if command -v conda >/dev/null 2>&1; then
    conda info --base 2>/dev/null && return
  fi
  for candidate in \
    "${CONDA_PREFIX:-}" \
    "${HOME}/miniconda3" "${HOME}/anaconda3" \
    "/opt/conda" "/opt/miniconda3" "/opt/anaconda3" \
    "/root/miniconda3" "/root/anaconda3"; do
    if [ -n "$candidate" ] && [ -f "$candidate/etc/profile.d/conda.sh" ]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

CONDA_BASE="$(find_conda_base || true)"
if [ -z "$CONDA_BASE" ]; then
  echo "❌ 找不到 conda。请先安装 miniconda 或 anaconda。"
  exit 1
fi

# shellcheck disable=SC1091
source "$CONDA_BASE/etc/profile.d/conda.sh"

# 若 craft 环境不存在 / 被损坏（没有 python 可执行文件），重建
CRAFT_PY="$CONDA_BASE/envs/${CONDA_ENV}/bin/python"
if [ ! -x "$CRAFT_PY" ]; then
  echo "📦 创建 conda 环境：${CONDA_ENV} (python ${PY_VERSION})..."
  # 如果存在空壳先删掉
  conda env list | awk '{print $1}' | grep -qx "${CONDA_ENV}" && conda env remove -n "${CONDA_ENV}" -y >/dev/null || true
  conda create -n "${CONDA_ENV}" "python=${PY_VERSION}" -y >/dev/null
fi

echo "🐍 激活 conda 环境：${CONDA_ENV}"
conda activate "${CONDA_ENV}"

# 验证当前的 python 就是 craft 的
ACTIVE_PY="$(which python)"
if [ "$ACTIVE_PY" != "$CRAFT_PY" ]; then
  # 有些 shell 下 PATH 顺序会让 base 的 python 胜出；强制使用 craft 的绝对路径
  echo "⚠️  PATH 顺序异常，用 craft 的 python 绝对路径运行"
fi

# 依赖（幂等）
echo "📚 安装/检查依赖..."
"$CRAFT_PY" -m pip install -q --disable-pip-version-check -r requirements.txt

# ------------------------------------------------------------
# 3) 启动 FastAPI
# ------------------------------------------------------------
# 环境隔离：APP_ENV=prod → Redis DB 0；APP_ENV=dev → Redis DB 1
# 默认 dev，避免调试污染现场数据
APP_ENV="${APP_ENV:-dev}"
case "$APP_ENV" in
  prod) REDIS_DB=0 ;;
  dev)  REDIS_DB=1 ;;
  test) REDIS_DB=2 ;;
  *)
    echo "❌ 未知的 APP_ENV=${APP_ENV}（只支持 prod|dev|test）"
    exit 1
    ;;
esac

export APP_ENV
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${REDIS_PORT}/${REDIS_DB}}"
HOST=${HOST:-0.0.0.0}
PORT=${PORT:-8000}

echo ""
echo "🐧 Infinity Craft · 鹅厂打工人版"
echo "🌍 Env:    ${APP_ENV}  (Redis DB ${REDIS_DB})"
echo "🗄️  Redis: configured"
echo "🐍 Python: $CRAFT_PY"
echo "👉 本机访问：http://localhost:$PORT"
echo "📺 首发墙：  http://localhost:$PORT/wall"
echo ""

exec "$CRAFT_PY" -m uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload
