# 权威种子公式全量对账设计

## 问题

本地 FastAPI 启动时仅在 Redis 不存在组合键时写入
`backend/seed_combinations.json`。历史 Redis 记录因此可以长期遮蔽后续更新的
种子公式。当前 859 条种子公式中有 65 条与 Redis 不一致，主页九步案例中
有 3 条受影响；例如权威值为“水 + 水 = 水塘”，运行值却是“海洋”。

SQLite 已持有正确值并不能修复运行结果，因为合成接口优先读取 Redis。
现有校验脚本也只比较 SQLite，无法发现这类 Redis 单边漂移。

## 选择方案

将种子文件定义为同键公式的权威真相源，并在每次 FastAPI 启动时主动对账
Redis 与 SQLite。

未采用以下方案：

- 只手工清理当前 65 条：能恢复当前环境，但下一次种子变更后仍会复发。
- 仅在请求时让 seed 优先于 Redis：运行结果正确，但配方校验、运维脚本和
  存储状态仍不一致。

## 数据规则

- 对 `seed_combinations.json` 中每个合法组合键，Redis 和 SQLite 的
  `result`、`emoji`、`source`、`chain`、`comment` 必须与种子一致。
- 修正既有记录时保留 SQLite 的 `created_at` 和 `hit_count`。
- 不删除或修改种子文件之外的动态、LLM 或社区公式。
- 不修改 `first_discoveries`；历史首发属于玩家数据。
- EdgeOne Makers 继续使用现有的“seed 先于 KV”解析顺序，不改变其行为。

## 实现

扩展 SQLite upsert，使调用方可以明确请求替换既有组合字段。让
`db.put_cache_force` 真正同时覆盖 Redis 和 SQLite，并由 `SeedStore.load`
对每条合法种子公式调用该强制同步路径。

普通动态组合仍使用非覆盖的 `db.put_cache`，继续保持“首次生成定型”的
现有规则。启动日志继续报告已同步的种子公式数量。

## 主页案例保护

自动测试从首页 `.case-step` 读取九步案例，规范化每一对输入，并逐项核对
`seed_combinations.json` 的结果与 emoji。这样首页文案或种子公式任一侧
发生漂移都会阻止测试通过。

另增加种子加载器回归测试：先放入错误的 Redis/SQLite 同键记录，加载种子
后断言两边都被修正，同时命中次数保持不变、非种子公式保持不变。

## 运行修复与验证

代码部署后重启本地 Web 容器，启动对账会修复当前 65 条 Redis 冲突。
随后全量扫描 859 条种子公式，要求 Redis 冲突数和缺失数均为 0，并通过
主页九步案例、Python 测试、Node 测试和构建验证。

