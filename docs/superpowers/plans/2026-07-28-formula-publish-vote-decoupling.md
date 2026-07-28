# Formula Publish Vote Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make formula publication a single-stage in-canvas action and allow active formula voting independent of public visibility.

**Architecture:** Keep the existing `CommunityStore` aggregate. Change `vote()` to accept hidden active formulas while returning a minimal hidden vote view. Change the shared combine feedback renderer copy and success DOM.

**Tech Stack:** EdgeOne Makers JavaScript, browser-native JavaScript, Node test runner, pytest browser harness where available.

## Global Constraints

- Button text is exactly `公开这个公式`.
- Success text is exactly `✅ 已公开`.
- Success does not create a link or navigate.
- Hidden active formula votes do not expose formula inputs, result, emoji, or comment.
- Public formula lists still include only published formulas.

---

### Task 1: Allow hidden active formula voting safely

**Files:**
- Modify: `edge-functions/_lib/community.js`
- Modify: `tests-makers/community.test.mjs`

**Interfaces:**
- Consumes: `CommunityStore.vote(id, playerId, value)`.
- Produces: hidden vote response `{id, visibility, status, up_votes, down_votes, net_score, my_vote}`.

- [ ] Write a failing test that votes on a hidden active formula and asserts it stays absent from `listPublic()`.
- [ ] Verify the test fails with the current “只能为公开且有效的公式投票” behavior.
- [ ] Change `CommunityStore.vote()` to require active status but not public visibility.
- [ ] Return the existing `publicView()` for public formulas and a minimal hidden vote view for hidden formulas.
- [ ] Run `node tests-makers/community.test.mjs`.

### Task 2: Simplify publish button copy and success state

**Files:**
- Modify: `frontend/combine-feedback.js`
- Modify: `tests/test_combine_feedback.py`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: `COMBINE_FEEDBACK.renderPublishAction(doc, target, {publish})`.
- Produces: button text `公开这个公式`; success content `✅ 已公开` with no link.

- [ ] Update tests to expect the new button/success behavior.
- [ ] Verify the Node frontend contract fails while the old link exists.
- [ ] Change the renderer copy and remove success link creation.
- [ ] Run `node --test tests-makers/frontend.test.mjs tests-makers/community.test.mjs`.

### Task 3: Full verification

**Files:**
- No production changes.

- [ ] Run `npm test`.
- [ ] Run `git diff --check`.
