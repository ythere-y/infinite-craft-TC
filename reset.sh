#!/usr/bin/env bash
# ============================================================
# Infinity Craft · reset.sh
# 一键管理环境：清空 / 导出 / 导入 Redis 数据。
#
# 用法：
#   ./reset.sh              清空 dev 环境（默认，DB 1）
#   ./reset.sh dev          清空 dev 环境（DB 1）
#   ./reset.sh prod         清空 prod 环境（DB 0，二次确认）
#   ./reset.sh test         清空 test 环境（DB 2）
#   ./reset.sh all          清空全部环境（强确认）
#   ./reset.sh dump prod    导出 prod 数据到 data/backup/prod-YYYYmmdd-HHMMSS.json
#   ./reset.sh restore <file> <env>  把 JSON 导回某环境
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

REDIS_CONTAINER="${REDIS_CONTAINER:-ic-redis}"
REDIS_PORT="${REDIS_PORT:-16739}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

# 映射 env → DB index
env_to_db() {
  case "$1" in
    prod) echo 0 ;;
    dev)  echo 1 ;;
    test) echo 2 ;;
    *)    echo "unknown" ;;
  esac
}

redis_exec() {
  # 用容器内的 redis-cli，避免依赖宿主机
  docker exec -i "$REDIS_CONTAINER" redis-cli "$@"
}

require_running() {
  if ! docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
    echo "❌ Redis 容器 ${REDIS_CONTAINER} 未运行，请先 ./run.sh 或 docker start ${REDIS_CONTAINER}"
    exit 1
  fi
}

confirm() {
  # $1 = 提示语
  read -r -p "$1 (y/N) " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# ------------------------------------------------------------
# 子命令：clean
# ------------------------------------------------------------
cmd_clean() {
  local env="$1"
  local db
  db=$(env_to_db "$env")
  if [[ "$db" == "unknown" ]]; then
    echo "❌ 未知环境：$env（只支持 prod|dev|test）"
    exit 1
  fi

  if [[ "$env" == "prod" ]]; then
    echo "⚠️  你正在清空 PROD 数据！"
    confirm "确定继续？所有 prod 合成缓存、首发榜、KPI、昵称占位都会消失。" || exit 0
  fi

  require_running
  local before
  before=$(redis_exec -n "$db" DBSIZE | tr -d '\r')
  redis_exec -n "$db" FLUSHDB >/dev/null
  echo "✅ [${env}] Redis DB ${db}: 已清空（删除前 ${before} 个 key）"
}

# ------------------------------------------------------------
# 子命令：all（清全部 DB）
# ------------------------------------------------------------
cmd_all() {
  echo "⚠️  你正在清空所有环境（prod + dev + test）！"
  confirm "确定？这是不可逆操作。" || exit 0
  require_running
  for env in prod dev test; do
    local db
    db=$(env_to_db "$env")
    local before
    before=$(redis_exec -n "$db" DBSIZE | tr -d '\r')
    redis_exec -n "$db" FLUSHDB >/dev/null
    echo "✅ [${env}] DB ${db}: ${before} → 0"
  done
}

# ------------------------------------------------------------
# 子命令：dump（导出为 JSON）
# ------------------------------------------------------------
cmd_dump() {
  local env="$1"
  local db
  db=$(env_to_db "$env")
  if [[ "$db" == "unknown" ]]; then
    echo "❌ 未知环境：$env"
    exit 1
  fi
  require_running

  mkdir -p data/backup
  local ts
  ts=$(date +%Y%m%d-%H%M%S)
  local file="data/backup/${env}-${ts}.json"

  # 用 Python 脚本遍历 key 并 dump 成 JSON（结构保留）
  "$PYTHON_BIN" - <<PYEOF > "$file"
import json, redis
r = redis.from_url("redis://127.0.0.1:${REDIS_PORT}/${db}", decode_responses=True)
out = {}
for key in r.scan_iter("*"):
    t = r.type(key)
    if t == "string":
        out[key] = {"_type": "string", "value": r.get(key)}
    elif t == "hash":
        out[key] = {"_type": "hash", "value": r.hgetall(key)}
    elif t == "list":
        out[key] = {"_type": "list", "value": r.lrange(key, 0, -1)}
    elif t == "set":
        out[key] = {"_type": "set", "value": list(r.smembers(key))}
    elif t == "zset":
        out[key] = {"_type": "zset", "value": r.zrange(key, 0, -1, withscores=True)}
json.dump(out, __import__("sys").stdout, ensure_ascii=False, indent=2)
PYEOF

  local cnt
  cnt=$(redis_exec -n "$db" DBSIZE | tr -d '\r')
  echo "✅ [${env}] 导出 ${cnt} 个 key → ${file}"
}

# ------------------------------------------------------------
# 子命令：restore
# ------------------------------------------------------------
cmd_restore() {
  local file="$1"
  local env="$2"
  local db
  db=$(env_to_db "$env")
  if [[ "$db" == "unknown" ]]; then
    echo "❌ 未知环境：$env"
    exit 1
  fi
  if [[ ! -f "$file" ]]; then
    echo "❌ 找不到备份文件：$file"
    exit 1
  fi
  require_running

  echo "⚠️  将把 ${file} 恢复到 [${env}] (DB ${db})"
  echo "    当前 DB 有 $(redis_exec -n "$db" DBSIZE | tr -d '\r') 个 key，恢复前会先清空"
  confirm "继续？" || exit 0

  redis_exec -n "$db" FLUSHDB >/dev/null

  "$PYTHON_BIN" - "$file" <<PYEOF
import json, sys, redis
fp = sys.argv[1]
r = redis.from_url("redis://127.0.0.1:${REDIS_PORT}/${db}", decode_responses=True)
data = json.load(open(fp, encoding="utf-8"))
for k, v in data.items():
    t = v["_type"]
    if t == "string":
        r.set(k, v["value"])
    elif t == "hash":
        if v["value"]:
            r.hset(k, mapping=v["value"])
    elif t == "list":
        if v["value"]:
            r.rpush(k, *v["value"])
    elif t == "set":
        if v["value"]:
            r.sadd(k, *v["value"])
    elif t == "zset":
        if v["value"]:
            r.zadd(k, {m: float(s) for m, s in v["value"]})
print(f"restored {len(data)} keys")
PYEOF

  echo "✅ 恢复完成"
}

# ------------------------------------------------------------
# 入口
# ------------------------------------------------------------
SUB="${1:-dev}"

case "$SUB" in
  prod|dev|test)   cmd_clean "$SUB" ;;
  all)             cmd_all ;;
  dump)            cmd_dump "${2:-dev}" ;;
  restore)
    if [[ $# -lt 3 ]]; then
      echo "用法：$0 restore <备份文件> <env>"
      exit 1
    fi
    cmd_restore "$2" "$3"
    ;;
  -h|--help|help)
    grep -E '^#' "$0" | sed 's/^# \?//' | head -20
    ;;
  *)
    echo "未知子命令：$SUB"
    echo "运行 $0 --help 查看用法"
    exit 1
    ;;
esac
