# Infinity Craft 悬赏目录与 Content Epoch 2 设计

日期：2026-08-04

状态：设计已确认，等待用户审阅文档

内容世代：`content_epoch = 2`

## 1. 背景

Infinity Craft 的内容方向从“鹅厂打工人”扩展为“腾讯 + 中国互联网 + 集体记忆”。本轮治理需要同时解决四类问题：

1. 悬赏清单在 Python 后端和 Makers Edge 端重复维护，容易漂移。
2. 部分固定公式存在事实错误、牵强谐音、错误归属或不可达的问题。
3. 腾讯经典产品、代理游戏、QQ 时代记忆、游戏工作室和关联组织覆盖不足。
4. 删除种子公式后，SQLite、Redis 或 Makers KV 中的旧记录仍可能在初始化时复活。

当前环境尚未正式上线，所有本地和 Makers 数据均为测试数据。本轮允许硬删除游戏数据和测试用户进度，以换取一份无历史包袱、可重复初始化的 epoch 2 内容库。

## 2. 目标

- 建立唯一的腾讯悬赏内容目录，生成 Python 与 Edge 运行时产物。
- 所有悬赏目标至少有一条从初始元素出发、完全固定且可理解的合成路线。
- 未命中固定公式时继续允许 AI 产生新路线；AI 路线不能覆盖标准路线。
- 保留原版水、火、风、土及其已有经典合成链。
- 扩展 QQ 时代、经典游戏、当代产品、游戏工作室和 40 个关联组织。
- 用 `content_epoch` 管理破坏性内容世代，用内容摘要管理同一世代内的日常同步。
- 在本地 SQLite、Redis 和 Makers KV 中彻底清理 epoch 1 数据，防止旧公式复活。
- 为目录一致性、公式唯一性、真实可达性、跨运行时一致性和迁移幂等性建立自动验证。

## 3. 非目标

- 本轮不保留测试用户库存、首发记录、社区公式、成就或历史发现。
- 本轮不把本地服务连接到 Makers KV。
- 本轮不改变 AI 模型供应方式或 Makers Models 绑定。
- 本轮不重做悬赏清单的整体视觉样式；只允许为新增分组、别名和初始化状态做必要适配。
- 不把所有与腾讯发生过弱关系的公司都收入悬赏清单；“关联组织”仍采用精选白名单。

## 4. 核心决策

### 4.1 十一个初始元素

epoch 2 的初始元素固定为：

```text
水、火、风、土、企鹅、人、时间、AI、电脑、手机、网络
```

变化如下：

- 保留原版四元素和既有 `classic` 公式。
- 保留企鹅、人、时间、AI。
- 新增电脑、手机、网络。
- 微信不再是初始元素，改为标准可合成目标。
- 工位不再是初始元素，改为普通可合成元素。

关键桥梁公式包括：

```text
人 + 电脑 → 工位
电脑 + 网络 → 互联网
手机 + 网络 → 移动互联网
人 + 互联网 → 聊天
企鹅 + 互联网 → 腾讯
企鹅 + 聊天 → QQ
腾讯 + 移动互联网 → 微信
```

这些桥梁让 PC 互联网、移动互联网、腾讯品牌、QQ 和微信形成独立但能交汇的主干。

初始元素不作为悬赏目标。企鹅等具有腾讯辨识度的初始元素仍可出现在元素图鉴或分组说明中，但不占用“必须拥有标准合成公式”的悬赏位。

### 4.2 单一权威目录

新增一个面向腾讯主题内容的权威目录：

```text
content/tencent-bounty-catalog.json
```

目录负责描述：

- 分组及展示顺序。
- 悬赏目标的正式名称、emoji、分类和别名。
- 每个目标的标准公式。
- 为标准路线服务但不一定进入悬赏榜的隐藏过渡元素与公式。
- 关联组织的关系类型、资料日期和来源链接。
- 需要退役的旧配方对和旧名称。
- `content_epoch`、目录版本和生成摘要。

生成脚本读取权威目录以及保留的通用种子数据，产出：

```text
backend/generated/bounty-content.json
edge-functions/_lib/generated-bounty-content.js
```

现有 `backend/bounty.py` 和 `edge-functions/_lib/bounty.js` 改为薄适配层，不再手写白名单。生成产物需要提交到仓库，测试会重新生成并确认没有漂移。

通用自然、生活和社会合成仍由现有种子文件负责；腾讯悬赏目标及其支撑路线只在新目录中维护，避免同一条腾讯公式出现两个权威来源。

### 4.3 目录分组

epoch 2 采用以下分组：

1. 鹅厂文化
2. QQ 时代记忆
3. 腾讯游戏
4. 当代产品
5. 游戏工作室
6. 办公楼与园区
7. 职级体系
8. 关联组织

“被投公司”在界面和目录分类中统一改为“关联组织”，内部分类键使用 `association`。旧键 `invest` 仅作为 epoch 1 迁移输入，不再生成到新数据。

每个正式目标只能属于一个主分组，别名不得建立第二个目标。跨领域关系通过元数据和公式体现，不重复占用悬赏位。例如 Riot Games、Supercell 和 Epic Games 归入“关联组织”，不再混入腾讯内部“游戏工作室”；腾讯音乐娱乐集团与阅文集团也归入“关联组织”，其产品分别留在产品分组。

### 4.4 QQ 时代记忆

该分组目标约 44 个，包含正式产品、付费身份和经典行为：

```text
QQ、OICQ、手机QQ、QQ游戏、QQ游戏大厅、QQ空间、QQ秀、QQ邮箱、
QQ音乐、QQ浏览器、QQ宠物、QQ农场、QQ牧场、QQ餐厅、抢车位、
QQ校友、朋友网、腾讯微博、WebQQ、腾讯TT、QQ旋风、Q币、QQ会员、
超级QQ、黄钻、红钻、绿钻、蓝钻、紫钻、粉钻、黑钻、QQ等级、
太阳号、你是GG还是MM、滴滴滴、窗口抖动、隐身上线、在线升级、
踩空间、偷菜、灰色头像、个性签名、QQ分组、留言板
```

正式名称使用“Q宠大乐斗”。“Q宠大乱斗”作为输入别名归一化到“Q宠大乐斗”，不建立重复目标。

代表性公式：

```text
QQ + 游戏 → QQ游戏
QQ游戏 + 电脑 → QQ游戏大厅
QQ + 宠物 → QQ宠物
QQ宠物 + 格斗 → Q宠大乐斗
QQ空间 + 农场 → QQ农场
QQ农场 + 好友 → 偷菜
QQ + 陌生网友 → 你是GG还是MM
QQ + 震动 → 窗口抖动
QQ空间 + 装扮 → 黄钻
QQ秀 + 会员 → 红钻
QQ音乐 + 会员 → 绿钻
QQ游戏 + 会员 → 蓝钻
DNF + 会员 → 黑钻
```

### 4.5 腾讯游戏

该分组优先覆盖腾讯自研、代理发行和长期运营中最能引起玩家共鸣的作品，包括：

```text
QQ堂、QQ幻想、自由幻想、QQ三国、QQ华夏、QQ飞车、QQ炫舞、
QQ音速、洛克王国、Q宠大乐斗、弹弹堂、穿越火线、DNF、寻仙、
逆战、战地之王、剑灵、上古世纪、使命召唤Online、NBA2K Online、
FIFA Online、天涯明月刀、御龙在天、轩辕传奇、斗战神、节奏大师、
天天酷跑、天天爱消除、全民飞机大战、欢乐斗地主、欢乐麻将、
英雄联盟、王者荣耀、和平精英、金铲铲之战、火影忍者手游
```

目录必须区分 `in_house`、`licensed`、`co_developed` 和 `published`，不能把腾讯运营等同于腾讯研发。DNF 与穿越火线标记为代理产品；弹弹堂标记为第七大道研发、腾讯代理的正版手游合作。

正式名称和常用名通过别名统一，例如：

- `地下城与勇士` → `DNF`
- `CF` → `穿越火线`
- `金铲铲` → `金铲铲之战`

### 4.6 游戏工作室与关联组织

游戏工作室固定为以下 14 个腾讯内部工作室群或工作室：

```text
天美工作室群、光子工作室群、魔方工作室群、北极光工作室群、
NExT Studios、Team Jade、MoreFun Studios、Aurora Studio、
LIGHTSPEED LA、Uncapped Games、Quantum Studio、S Studio、
R Studio、TiKi Studio
```

目录可为“天美”“光子”“魔方”“北极光”等玩家习惯称呼配置别名，但只展示正式目标。Riot Games、Supercell、Epic Games 等公司不属于该内部工作室分组。

不得用作品反推错误工作室，例如不得再使用：

```text
DNF + 工作室 → 魔方
穿越火线 + 工作室 → 北极光
```

关联组织固定选择以下 40 个：

```text
Riot Games、Supercell、Epic Games、Funcom、Sumo Group、
Digital Extremes、Sharkmob、Grinding Gear Games、Klei Entertainment、
Miniclip、腾讯音乐娱乐集团、阅文集团、微众银行、Ubisoft、Techland、
Remedy Entertainment、Paradox Interactive、PlatinumGames、KADOKAWA、
Sea、Spotify、Snap、Reddit、快手、哔哩哔哩、拼多多、蔚来、小红书、
知乎、京东、美团、Neople、Smilegate、第七大道、Take-Two、EA、
Activision、Nexon、KRAFTON、NCSoft
```

这份名单覆盖腾讯子公司或控股主体、公开股权投资、历史投资，以及腾讯代理游戏背后的开发或授权组织。若实施时无法为某个关系找到公司公告、监管披露、投资者关系材料或交易对方公告，则目录生成失败；必须先修订并重新审阅本设计，不能用媒体转述凑数或在实施阶段自行换名单。

目录允许四种关系：

- `subsidiary`：腾讯控股或并表主体。
- `equity_investment`：公开披露的股权投资。
- `licensed_partner`：游戏开发、授权或联合发行合作。
- `historical_association`：曾有明确关系，但当前关系已变化。

每条关系必须包含：

```json
{
  "kind": "licensed_partner",
  "as_of": "2016-07-29",
  "source_url": "https://www.7road.com/index.php/article/index/id/139.html",
  "source_title": "七道携手腾讯游戏 ChinaJoy强势新品亮相",
  "note": "第七大道研发、腾讯游戏代理《弹弹堂》正版手游"
}
```

关系本身和合成公式分开。公式表达组织身份，不暗示所有权：

```text
DNF + 开发商 → Neople
穿越火线 + 开发商 → Smilegate
弹弹堂 + 开发商 → 第七大道
英雄联盟 + 开发商 → Riot Games
外卖 + 团购 → 美团
短视频 + 老铁 → 快手
问答 + 知识 → 知乎
社区 + 种草 → 小红书
```

因此不再出现“堡垒之夜 + 收购 → Epic”等事实性错误。

## 5. 公式治理

### 5.1 标准公式

每个悬赏目标必须有且只有一个 `canonical_recipe`。标准公式需要同时满足：

- 两个输入与结果之间存在可解释的语义关系。
- 无错误的研发、代理、投资或组织归属暗示。
- 输入顺序无关，规范化后的配方对全局唯一。
- 两个输入都能从十一项初始元素沿固定公式到达。
- 最终目标能从十一项初始元素实际到达。

可保留极少量 `bonus_recipes` 作为彩蛋，但它们不能替代标准路线，也不能用于掩盖标准路线不可达。牵强谐音、硬凑鹅厂词和错误事实公式全部退役。

### 5.2 路径长度

路径深度定义为从初始元素到目标的最短固定合成层数，而不是配方记录数量或 AI 发现次数。

目标路线需要自然分布在至少三个深度区间：

- 浅层：核心概念和主干元素。
- 中层：产品、会员、经典功能和常见游戏。
- 深层：复合梗、工作室、关联组织和需要多条主干交汇的目标。

不得为增加深度而插入“高级、神秘、终极”等无语义填充词。隐藏过渡元素可以不进入悬赏榜，但必须有用途、emoji、分类和固定生产公式。

### 5.3 AI 路线

运行时解析顺序为：

1. 查询标准固定公式。
2. 查询已通过治理的社区或动态公式。
3. 未命中时调用 AI。

AI 可以产生悬赏目标，并形成一条玩家发现路线。该路线记录为动态公式，但不能修改 `canonical_recipe`，不能改变目录计算出的标准深度，也不能覆盖标准配方对。

### 5.4 微信路线重建

微信退出初始元素后，所有依赖微信的目标必须重新验证。保留自然的下游关系：

```text
微信 + 工作 → 企业微信
微信 + 动态 → 朋友圈
微信 + 订阅 → 公众号
公众号 + 轻应用 → 小程序
微信 + 钱包 → 微信支付
微信支付 + 新年 → 红包
微信 + 短视频 → 视频号
```

删除错误归属：

```text
微信 + 短视频 → 微视
云 + 微信 → 微云
```

替换为：

```text
腾讯 + 短视频 → 微视
腾讯 + 云盘 → 微云
```

## 6. Content Epoch

### 6.1 Epoch 与内容摘要

使用两个独立字段：

| 字段 | 含义 |
|---|---|
| `content_epoch` | 破坏性、不兼容的内容世代 |
| `catalog_digest` | 规范化后的权威目录与通用种子输入的内容摘要 |

现有内容视为 epoch 1，本轮为 epoch 2。没有 epoch 标记但存在游戏数据的环境按 epoch 1 处理；空存储直接引导到 epoch 2。

以下变化需要提升 epoch：

- 改变初始元素集合。
- 大规模删除或改变旧公式结果。
- 改变元素身份、分类或成就语义。
- 需要重置玩家库存、历史发现或社区公式。
- 存储结构发生不兼容变化。

普通新增目标、增加公式、修复 emoji 或文案，只改变 `catalog_digest`，不自动提升 epoch，也不全量重置玩家进度。

生成产物携带该摘要但不参与摘要计算，避免循环依赖。Python 与 Edge 产物必须来自同一份已规范化输入。

### 6.2 Epoch 2 清理范围

本轮硬删除所有游戏运行时测试数据：

- 用户库存、合成历史和首发记录。
- 社区公式、版本指针、审核状态和退役记录。
- 动态 AI 配方。
- 固定配方缓存及旧种子配方。
- 元素记录、元素索引和深度缓存。
- 悬赏进度和成就记录。

保留数据库结构、系统迁移表、部署配置、环境变量、模型绑定和 epoch 初始化状态。删除范围必须限定为 Infinity Craft 自己的数据库表和 KV 键，不能影响同一平台上的其他项目。

## 7. 本地 SQLite 与 Redis 初始化

本地启动顺序调整为：

```text
初始化数据库结构
→ 检查 content_epoch
→ 执行或恢复 epoch 迁移
→ 重建 SQLite 标准内容
→ 清理并重建 Redis
→ 加载运行时 Store
→ 计算深度
→ 标记 ready
```

迁移必须发生在 `warm_up_from_archive()` 之前，从根源上阻止 SQLite 中旧种子公式重新写回 Redis。

SQLite 使用事务删除 epoch 1 游戏数据并写入 epoch 2 标准数据。迁移状态与最终完成标记分开；SQLite 阶段完成而 Redis 重建失败时，下次启动直接重建 Redis，不重复制造业务数据。

Redis 不直接编辑 `dump.rdb`。初始化通过 Redis 协议清理当前游戏使用的逻辑数据库或已登记的游戏键，然后从 SQLite 和 epoch 2 目录重新构建。迁移完成前不接受正常游戏请求。

## 8. Makers KV 初始化

Makers Cloud Functions 没有传统常驻进程启动钩子，因此在请求入口增加共享的 `ensureContentInitialized()`。同一实例复用 Promise，不同实例通过 KV 中的迁移状态协调。

状态记录等价于：

```json
{
  "epoch": 2,
  "catalog_digest": "sha256:...",
  "status": "migrating",
  "phase": "purge_runtime_data",
  "cursor": null,
  "started_at": "2026-08-04T00:00:00Z",
  "completed_at": null
}
```

状态机阶段：

```text
detect
→ purge_runtime_data
→ seed_starters
→ seed_recipes
→ rebuild_indexes
→ verify_catalog
→ ready
```

KV 删除和写入按平台限制分批执行，并在每批后记录游标。每一步必须幂等：

- 同一批删除执行两次仍成功。
- 同一条标准记录重复写入得到相同内容。
- 只有验证全部通过才写入 `ready`。
- 中断后从已记录阶段和游标继续。

迁移期间：

- 健康检查返回 `initializing`、当前阶段和 epoch。
- 游戏读写接口返回 503 和稳定错误码 `CONTENT_INITIALIZING`。
- 不允许 AI 生成或写入动态公式。

目录摘要改变但 epoch 不变时，执行差异同步：新增标准目标和公式、更新发生变化的标准记录、按明确退役清单删除旧记录，不清空全部用户数据。

## 9. 并发、失败与恢复

- 初始化逻辑不得依赖单个实例内存状态判断全局完成。
- 多个冷启动实例同时进入时，迁移步骤仍须幂等；锁只用于减少重复工作，不能成为正确性的唯一保障。
- 任一阶段失败都保留 `migrating` 状态、阶段、游标和错误摘要。
- 下一次请求或冷启动继续迁移。
- 超时、KV 分页中断或模型不可用不应把状态误写为 `ready`。
- `ready` 记录必须同时匹配 `content_epoch` 和 `catalog_digest`。
- 运行时发现摘要不匹配时立即重新进入初始化，不继续提供混合版本内容。

## 10. 验证与验收

### 10.1 内容验证

- 初始元素严格等于十一项确认列表。
- 原 `classic` 公式键与结果保持不变。
- 每个悬赏目标存在于元素目录中。
- 每个悬赏目标恰有一个标准公式。
- 每个标准公式对全局唯一且输入顺序无关。
- 每个标准输入和目标都能从真实初始元素固定到达。
- 至少存在浅、中、深三个目标深度区间。
- 隐藏过渡元素全部可达且至少被一条标准路线使用。
- 别名不生成重复元素。
- 不再生成 `invest` 分类。
- 每个正式目标只属于一个主分组。
- Python 与 Edge 生成内容的摘要和语义完全一致。

### 10.2 数据迁移验证

- 无标记旧库被识别为 epoch 1 并迁移到 epoch 2。
- 空库直接初始化 epoch 2。
- 迁移中断后能继续。
- 重复执行 epoch 2 初始化为无副作用操作。
- SQLite 中不存在退役配方。
- Redis 和 Makers KV 中不存在退役配方、旧索引或旧深度。
- 旧公式不能通过 archive warm-up 复活。
- 初始化期间不能写入玩家或 AI 数据。
- `ready` 后标准目录、缓存和运行时解析结果一致。

### 10.3 项目级验证

实现完成后执行项目要求的验证：

```text
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

具有 EdgeOne CLI 的部署维护者额外执行：

```text
npm run makers:build
```

## 11. 资料来源与事实治理

目录优先采用腾讯、游戏开发商、发行商、上市公司投资者关系页面和正式公告。非官方资料只能用于发现候选词，不能单独支撑组织关系。

本轮设计参考的主要资料：

- 腾讯公司发展历程：<https://www.tencent.com/zh-cn/who-we-are/our-story/>
- 腾讯 QQ 游戏历史介绍：<https://www.tencent.com/zh-cn/articles/80226.html>
- 腾讯游戏产品介绍：<https://www.tencent.com/zh-cn/products/tencent-games/>
- 腾讯 PC 与移动游戏公开资料表：<https://static.www.tencent.com/uploads/2023/08/16/1e0a88fd7fe3c67f2e407e5885e76324.pdf>
- 腾讯 2025 年中期报告：<https://static.www.tencent.com/uploads/2025/08/26/d1d2fb988f5e910e254b3abb41dadb0f.pdf>
- 第七大道关于腾讯代理《弹弹堂》正版手游的公告：<https://www.7road.com/index.php/article/index/id/139.html>
- 天美工作室群介绍：<https://www.tencent.com/en-us/articles/2201253.html>
- LIGHTSPEED 工作室与团队：<https://www.lightspeed-studios.com/m/join-us.html>
- Team Jade 介绍：<https://www.tencent.com/en-us/articles/2202036.html>
- MoreFun Studios 介绍：<https://www.tencent.com/en-us/articles/2201541.html>
- NExT Studios 介绍：<https://www.tencent.com/en-us/articles/2201369.html>
- Riot 收购披露：<https://static.www.tencent.com/storage/uploads/2019/11/09/16268c0ec6dbd0144fee788583389fd8.pdf>
- Supercell 交易披露：<https://static.www.tencent.com/storage/uploads/2019/11/09/623d380025f37fd250fa09f7b90e3d6e.pdf>
- Epic 少数股权披露：<https://static.www.tencent.com/storage/uploads/2019/11/09/4668ca807dfa624f5d252297128a0f37.pdf>

关系变化时更新 `as_of`、来源和说明；不得仅修改显示名称而保留过时关系类型。

## 12. 实施边界

本设计作为一个实施计划完成，按以下顺序落地：

1. 建立目录模式、生成器和一致性测试。
2. 治理公式并扩充悬赏内容。
3. 重构 Python 与 Edge 悬赏读取。
4. 实现 epoch 2 的本地 SQLite/Redis 初始化。
5. 实现 Makers KV 可恢复初始化。
6. 执行本地数据迁移与完整验证。

任何需要真实 Makers 账号、线上部署或 PR 合并的动作仍遵循项目生产流程；本地开发不得连接 Makers KV。
