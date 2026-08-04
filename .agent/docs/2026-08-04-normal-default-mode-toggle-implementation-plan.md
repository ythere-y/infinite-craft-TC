# 普通模式默认启动与顶栏切换按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让游戏默认以普通模式启动，并提供一个与键盘秘籍共享状态的顶栏双向模式切换按钮。

**Architecture:** `frontend/effects.js` 继续拥有唯一的里模式状态和切换逻辑，并导出 `EFFECTS.toggleUraMode()`。顶栏按钮在初始化时绑定到该方法，按钮展示由真实模式状态同步；`frontend/app.js` 只负责以关闭状态初始化模式系统。

**Tech Stack:** 原生 HTML、CSS、JavaScript，pytest 浏览器回归测试，无新增依赖。

## Global Constraints

- 新会话默认显示普通模式。
- 普通模式按钮显示“🌙 里模式”；里模式按钮显示“☀️ 普通模式”。
- 保留 `↑↑↓↓←→←→BA` 双向切换和现有进退场动画。
- 不持久化玩家上次选择，不修改筹码和计分规则。
- 窄屏只显示模式 emoji，并保留准确的 `title`、`aria-label` 和 `aria-pressed`。
- 不修改或暂存其他开发者的无关工作树文件。

---

### Task 1: 默认普通模式与统一模式切换入口

**Files:**
- Modify: `tests/test_casino_mode_ui.py:240-520`
- Modify: `tests/test_casino_mode_ui.py:627-653`
- Modify: `frontend/index.html:19-34`
- Modify: `frontend/effects.js:464-557`
- Modify: `frontend/app.js:264-282`
- Modify: `frontend/style.css:2820-2925`

**Interfaces:**
- Consumes: `EFFECTS.isUraMode(): boolean` 和现有 `ura-mode-change` 事件。
- Produces: `EFFECTS.toggleUraMode(): void`；DOM 按钮 `#btn-mode-toggle`，包含 `.mode-toggle-icon` 和 `.action-label`。

- [ ] **Step 1: 将浏览器测试改为期望普通模式默认启动**

在 `_production_app_page()` 的探针中读取按钮快照：

```javascript
function modeButtonState() {
  var button = document.getElementById("btn-mode-toggle");
  return {
    text: button.textContent.replace(/\\s+/g, " ").trim(),
    title: button.title,
    label: button.getAttribute("aria-label"),
    pressed: button.getAttribute("aria-pressed")
  };
}

var initial = {
  active: window.EFFECTS.isUraMode(),
  transitionCount: document.querySelectorAll(".ura-transition").length,
  event: window.__uraEvents[0] || null,
  button: modeButtonState()
};
```

随后先点击 `#btn-mode-toggle` 进入里模式，等待 650ms 并记录状态；再次点击
退出并等待 30ms；最后输入一次秘籍再次进入并记录进场动画数和按钮状态。
测试断言：

```python
assert actual["initial"] == {
    "active": False,
    "transitionCount": 0,
    "event": None,
    "button": {
        "text": "🌙 里模式",
        "title": "切换到里模式",
        "label": "切换到里模式",
        "pressed": "false",
    },
}
assert actual["after_button_enter"]["active"] is True
assert actual["after_button_enter"]["button"]["text"] == "☀️ 普通模式"
assert actual["after_button_enter"]["button"]["pressed"] == "true"
assert actual["after_button_exit"]["active"] is False
assert actual["after_button_exit"]["button"]["text"] == "🌙 里模式"
assert actual["after_code"]["active"] is True
assert actual["after_code"]["entranceTransitionCount"] == 1
assert actual["after_code"]["button"]["text"] == "☀️ 普通模式"
assert [event["active"] for event in actual["events"][:3]] == [True, False, True]
```

- [ ] **Step 2: 运行目标测试并确认 RED**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_game_starts_in_normal_mode_and_button_and_code_toggle_inner_mode -q
```

Expected: FAIL，因为 `#btn-mode-toggle` 尚不存在，且当前初始化仍默认开启里模式。

- [ ] **Step 3: 在顶栏添加模式按钮**

在 `#btn-help` 之前加入：

```html
<button id="btn-mode-toggle" class="btn-ghost mode-toggle-button"
        type="button" title="切换到里模式" aria-label="切换到里模式"
        aria-pressed="false">
  <span class="mode-toggle-icon" aria-hidden="true">🌙</span>
  <span class="action-label">里模式</span>
</button>
```

- [ ] **Step 4: 在模式状态机中实现按钮同步和公共切换方法**

在 `frontend/effects.js` 中增加：

```javascript
  function syncUraModeButton() {
    const button = document.getElementById("btn-mode-toggle");
    if (!button) return;
    const icon = button.querySelector(".mode-toggle-icon");
    const label = button.querySelector(".action-label");
    const target = uraOn ? "普通模式" : "里模式";
    if (icon) icon.textContent = uraOn ? "☀️" : "🌙";
    if (label) label.textContent = target;
    button.title = `切换到${target}`;
    button.setAttribute("aria-label", `切换到${target}`);
    button.setAttribute("aria-pressed", String(uraOn));
  }
```

在 `enterUra()` 设置 `uraOn = true` 后、`exitUra()` 设置 `uraOn = false` 后调用
`syncUraModeButton()`。导出统一入口，并把初始化默认值改为关闭：

```javascript
  EFFECTS.toggleUraMode = toggleUra;

  EFFECTS.initBossMode = function ({ defaultOn = false } = {}) {
    // 保留现有只绑定一次的键盘监听。
    const button = document.getElementById("btn-mode-toggle");
    if (button && button.dataset.modeToggleBound !== "true") {
      button.addEventListener("click", toggleUra);
      button.dataset.modeToggleBound = "true";
    }
    if (defaultOn && !uraOn) applyUraStableState(true);
    syncUraModeButton();
  };
```

将键盘秘籍命中后的内部调用改为 `EFFECTS.toggleUraMode()`，确保两个入口经过
相同的公共接口。将 `frontend/app.js` 初始化改为：

```javascript
window.EFFECTS?.initBossMode?.({ defaultOn: false });
```

- [ ] **Step 5: 增加窄屏按钮样式**

保持 `.mode-toggle-icon` 始终可见，并让其具有与现有操作图标一致的固定宽度：

```css
.mode-toggle-icon {
  display: inline-flex;
  width: var(--action-icon-well);
  height: var(--action-icon-well);
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--action-icon-well);
}
```

复用现有移动端 `.topbar-actions .action-label { display: none; }`，不新增断点。

- [ ] **Step 6: 运行目标测试并确认 GREEN**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_game_starts_in_normal_mode_and_button_and_code_toggle_inner_mode -q
```

Expected: PASS。

- [ ] **Step 7: 运行相关前端回归测试**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: 全部 PASS，赌场筹码、收获、暗色提示和普通模式计分行为没有回归。

- [ ] **Step 8: 提交功能改动**

```bash
git add frontend/index.html frontend/effects.js frontend/app.js frontend/style.css tests/test_casino_mode_ui.py
git commit -m "fix: restore normal mode default and add toggle"
```

---

### Task 2: 全量验证

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: Task 1 完成后的前端行为和测试。
- Produces: 满足仓库合并要求的验证证据。

- [ ] **Step 1: 运行 JavaScript 测试**

Run:

```bash
npm test
```

Expected: PASS。

- [ ] **Step 2: 运行 Python 测试**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: PASS。

- [ ] **Step 3: 构建前端**

Run:

```bash
npm run build
```

Expected: PASS，并成功生成构建输出。

- [ ] **Step 4: 检查最终差异**

Run:

```bash
git diff --check
git status --short
```

Expected: 无空白错误；仅出现本任务计划内的文件或已知用户文件。
