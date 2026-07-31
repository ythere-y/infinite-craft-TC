# 配方库关闭按钮与公式密度微调 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正配方库关闭按钮内部图标的显示，并缩小公式元素与间隔，同时增强加号和箭头。

**Architecture:** 保留现有动作图标渲染和 `fitRecipeRow(row)` 测量流程，仅增加配方库作用域 CSS 与测量变量。浏览器测试读取真实生产 HTML、CSS 和 JavaScript 的计算样式与几何尺寸，保证桌面、移动端和夜间模式一致。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Python pytest、Chromium headless、Node test runner。

## Global Constraints

- 直接在当前 `main` 工作区修改，不创建 worktree。
- 不改动或提交仓库中既有的无关暂存、未暂存文件。
- 关闭按钮保留 30×30 像素点击区域、右上角位置、标题、ARIA 标签、键盘焦点和关闭行为。
- 公式保持单行完整显示，不使用省略号或换行。
- 公式 Chip 的拖动与双击交互保持不变。
- 仅在配方库作用域覆盖动作图标，不影响全局 `.action-icon`。

---

### Task 1: 修正关闭图标并重新平衡公式密度

**Files:**
- Modify: `tests/test_recipebook_ui.py`
- Modify: `frontend/style.css`
- Modify: `frontend/app.js`

**Interfaces:**
- Consumes: `ICON_SYSTEM.hydrateActions(document)` 生成的 `.recipebook-close-button > .action-icon > img`；`fitRecipeRow(row)` 使用 `scrollWidth/clientWidth` 选择密度档。
- Produces: 配方库局部关闭图标几何规则；普通、`recipe-row-dense`、`recipe-row-ultra-dense`、`recipe-row-fit` 四档密度规则；`--recipe-row-fit-operator-size` 测量变量。

- [ ] **Step 1: 扩展真实浏览器测试，建立失败断言**

在 `_run_recipebook()` 的页面探针中读取：

```javascript
var closeIconWell = close.querySelector(".action-icon");
var closeIconWellRect = closeIconWell.getBoundingClientRect();
var closeIconRect = closeIcon.getBoundingClientRect();
var shortChip = shortRow.querySelector(".recipe-chip[data-name]");
var shortName = shortChip.querySelector(".name");
var shortPlus = shortRow.querySelector(".recipe-plus");
var shortArrow = shortRow.querySelector(".recipe-arrow");
var shortRowStyle = getComputedStyle(shortRow);
var shortChipStyle = getComputedStyle(shortChip);
var shortNameStyle = getComputedStyle(shortName);
var shortPlusStyle = getComputedStyle(shortPlus);
var shortArrowStyle = getComputedStyle(shortArrow);
```

把以下实际值写入结果 JSON，并在测试中断言：

```python
assert desktop["closeIconWellWidth"] == 30
assert desktop["closeIconWellHeight"] == 30
assert desktop["closeIconWidth"] == 14
assert desktop["closeIconHeight"] == 14
assert desktop["closeIconCenterDeltaX"] <= 0.5
assert desktop["closeIconCenterDeltaY"] <= 0.5
assert desktop["shortRowGap"] <= 4
assert desktop["shortChipPaddingLeft"] <= 5
assert desktop["shortChipIconWidth"] <= 22
assert desktop["shortPlusPaddingLeft"] == 0
assert desktop["shortPlusFontSize"] > desktop["shortNameFontSize"]
assert desktop["shortArrowFontSize"] > desktop["shortNameFontSize"]
assert desktop["shortPlusFontWeight"] >= 600
assert desktop["shortArrowFontWeight"] >= 600
assert desktop["shortPlusColor"] != desktop["shortNameColor"]
assert desktop["shortArrowColor"] != desktop["shortNameColor"]
assert desktop["nightPlusColor"] != desktop["nightRowColor"]
assert desktop["nightArrowColor"] != desktop["nightRowColor"]
```

- [ ] **Step 2: 运行目标测试并确认因旧尺寸而失败**

Run:

```bash
python3 -m pytest tests/test_recipebook_ui.py -q
```

Expected: FAIL；关闭图标容器仍为 25px、普通行 gap 为 8px、Chip 横向 padding 为 8px，或运算符字号/字重不满足新断言。

- [ ] **Step 3: 最小化修正关闭按钮内部图标**

在 `frontend/style.css` 的 `.recipebook-close-button` 规则附近添加局部覆盖：

```css
.recipebook-close-button > .action-icon {
  width: 100%;
  min-width: 0;
  height: 100%;
  display: grid;
  place-items: center;
  transform: none;
}
.recipebook-close-button > .action-icon > img {
  display: block;
  width: 14px;
  height: 14px;
}
```

保留现有夜间模式对该 `img` 的滤镜规则。

- [ ] **Step 4: 缩小公式内容并强化运算符**

在 `frontend/style.css` 中调整四档规则：

```css
.recipe-row {
  --element-icon-canvas: 22px;
  gap: 4px;
  padding: 7px 4px;
  font-size: 12px;
}
.recipe-chip {
  gap: 3px;
  padding: 2px 5px;
  border-radius: 10px;
  font-size: 11px;
}
.recipe-plus {
  padding-inline: 0;
}
.recipe-plus,
.recipe-arrow {
  color: #687381;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
```

紧凑档使用 18px 图标、3px 行 gap、10px 元素文字和 13px 运算符；超紧凑档使用 14px 图标、1px 行 gap、8px 元素文字和 10px 运算符。夜间模式把两个运算符颜色提高到比行文字更易区分的中亮紫灰色。

- [ ] **Step 5: 让测量压缩档保留更强的运算符**

在 `fitRecipeRow(row)` 的清理变量列表加入：

```javascript
"--recipe-row-fit-operator-size"
```

在迭代中同时设置：

```javascript
row.style.setProperty("--recipe-row-fit-operator-size", `${10 * scale}px`);
```

CSS 中让 `.recipe-row-fit .recipe-plus, .recipe-row-fit .recipe-arrow` 使用该变量并保持 `font-weight: 700`，不要继续与元素文字共用 `--recipe-row-fit-font-size`。

- [ ] **Step 6: 运行目标测试并确认通过**

Run:

```bash
python3 -m pytest tests/test_recipebook_ui.py -q
```

Expected: `1 passed`。

- [ ] **Step 7: 运行相关和完整回归**

Run:

```bash
node --check frontend/app.js
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
python3 -m pytest tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: 所有命令退出码为 0；仅允许现有第三方弃用警告。

- [ ] **Step 8: 仅提交本任务文件**

先用 `git diff -- tests/test_recipebook_ui.py frontend/style.css frontend/app.js` 审核本任务差异，再执行：

```bash
git commit --only tests/test_recipebook_ui.py frontend/style.css frontend/app.js \
  -m "fix: refine recipebook controls and formula density"
```

提交后确认原有 `frontend/recipe-links.css`、`frontend/recipe-links.js` 仍保持此前的暂存状态，其他用户修改未被提交。
