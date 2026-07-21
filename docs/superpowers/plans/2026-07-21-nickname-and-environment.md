# Nickname Lexicon and Environment Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the two-token nickname generator to at least 120,000 combinations with browser-side recent-result deduplication, while making the existing Redis + SQLite setup safely distinguish development, production, and test data.

**Architecture:** Keep the current FastAPI + Redis + SQLite architecture and the existing nickname claim API. Replace the runtime dependency on the ignored THUOCL checkout with one committed, validated lexicon artifact. Add a small pure-Python runtime settings validator and a small framework-free JavaScript history helper. Do not add a database control API, ORM, migration framework, authentication system, or new data service.

**Tech Stack:** Python 3.11, FastAPI, Redis 7, SQLite, pytest, browser JavaScript, Node.js built-in test runner, Docker Compose.

## Global Constraints

- Preserve the visible nickname format `<modifier>的<identity>鹅` and keep the two positions independently weighted.
- Keep `/api/nickname/peek` non-claiming and `/api/nickname/claim` backed by the existing Redis `SETNX` flow.
- The production image must not depend on `words/`, which is intentionally ignored and not copied by `Dockerfile`.
- Do not expose the full lexicon over an API. `/api/nickname/stats` returns counts and source metadata only.
- Keep Redis + SQLite; do not add a database web console or write-capable admin endpoint.
- Preserve all unrelated user changes. In particular, do not stage or edit the untracked `CLAUDE.md`.
- Never commit `.env`, runtime databases, Redis persistence files, logs, backups, API keys, private URLs, or review notes.
- Do not weaken the existing nickname content filters. Lexicon generation must pass every token through the runtime validator and deduplicate it.
- Keep changes deployable by both local `run.sh` and Docker Compose.

---

## Task 1: Add Test Infrastructure and Build the Bundled Nickname Lexicon

**Files:**

- Create: `requirements-dev.txt`
- Create: `scripts/build_nickname_words.py`
- Create: `backend/nickname_words.json`
- Create: `tests/test_nickname_words.py`
- Create: `THIRD_PARTY_NOTICES.md`
- Read only: `words/THUOCL/data/THUOCL_chengyu.txt`
- Read only: `words/THUOCL/data/THUOCL_IT.txt`
- Read only: `words/THUOCL/data/THUOCL_food.txt`
- Read only: `words/THUOCL/data/THUOCL_animal.txt`
- Read only: `words/THUOCL/LICENSE`

**Interfaces:**

- `scripts/build_nickname_words.py --source-dir PATH --output PATH`
- Output JSON schema:

  ```json
  {
    "schema_version": 1,
    "modifier_tokens": {
      "idiom": [],
      "internet_action": [],
      "tech_tone": []
    },
    "identity_tokens": {
      "internet_work": [],
      "tech_ai": [],
      "life_fun": [],
      "game_easter_egg": []
    }
  }
  ```

- Minimum distinct token counts: modifier `>= 400`, identity `>= 300`, Cartesian product `>= 120000`.

### Step 1.1: Add the failing lexicon contract test

- [ ] Create `requirements-dev.txt`:

  ```text
  -r requirements.txt
  pytest>=8,<9
  ```

- [ ] Create `tests/test_nickname_words.py` with schema, uniqueness, shape, and size checks:

  ```python
  import json
  import re
  from pathlib import Path


  LEXICON = Path(__file__).parents[1] / "backend" / "nickname_words.json"
  TOKEN_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff.+#_-]{1,12}$")


  def load_words() -> dict:
      return json.loads(LEXICON.read_text(encoding="utf-8"))


  def flatten(groups: dict[str, list[str]]) -> list[str]:
      return [token for values in groups.values() for token in values]


  def test_bundled_lexicon_has_expected_schema_and_capacity():
      data = load_words()
      assert data["schema_version"] == 1
      assert set(data["modifier_tokens"]) == {
          "idiom", "internet_action", "tech_tone"
      }
      assert set(data["identity_tokens"]) == {
          "internet_work", "tech_ai", "life_fun", "game_easter_egg"
      }

      modifiers = flatten(data["modifier_tokens"])
      identities = flatten(data["identity_tokens"])
      assert len(modifiers) >= 400
      assert len(identities) >= 300
      assert len(modifiers) * len(identities) >= 120_000


  def test_bundled_tokens_are_valid_and_deduplicated_across_categories():
      data = load_words()
      for side in ("modifier_tokens", "identity_tokens"):
          tokens = flatten(data[side])
          assert len(tokens) == len(set(tokens))
          assert all(TOKEN_RE.fullmatch(token) for token in tokens)
  ```

- [ ] Run the test and confirm it fails because the bundled artifact does not exist:

  ```bash
  python -m pytest tests/test_nickname_words.py -q
  ```

  Expected: failure containing `FileNotFoundError` for `backend/nickname_words.json`.

### Step 1.2: Add a deterministic build script

- [ ] Create `scripts/build_nickname_words.py`. It must:

  - accept `--source-dir` and `--output` with `argparse`;
  - read THUOCL files as UTF-8 and take the first tab/space-delimited field;
  - filter with the same allowed-character rule and existing project content filter;
  - preserve source frequency order while deduplicating;
  - select at least 450 usable idioms, 180 technical identity tokens, and 150 life/fun identity tokens;
  - merge those source-derived lists with curated internet-work, action-state, technical-tone, and game-easter-egg lists;
  - deduplicate across categories with first category winning;
  - fail with a non-zero exit if either side is below its capacity contract;
  - write stable UTF-8 JSON using `ensure_ascii=False`, `indent=2`, and a trailing newline;
  - write no source paths or machine-specific metadata into the JSON.

  Use this deterministic structure for the core implementation:

  ```python
  from __future__ import annotations

  import argparse
  import json
  import re
  from pathlib import Path

  TOKEN_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff.+#_-]{1,12}$")


  def source_words(path: Path, *, limit: int, min_len: int, max_len: int) -> list[str]:
      output: list[str] = []
      seen: set[str] = set()
      for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
          token = re.split(r"\s+", line.strip().replace("\ufeff", ""))[0]
          if token in seen or not min_len <= len(token) <= max_len:
              continue
          if not TOKEN_RE.fullmatch(token) or not content_allowed(token):
              continue
          seen.add(token)
          output.append(token)
          if len(output) >= limit:
              break
      return output


  def dedupe_groups(groups: dict[str, list[str]]) -> dict[str, list[str]]:
      seen: set[str] = set()
      result: dict[str, list[str]] = {}
      for category, tokens in groups.items():
          clean = []
          for token in tokens:
              token = token.strip()
              if token in seen or not TOKEN_RE.fullmatch(token) or not content_allowed(token):
                  continue
              seen.add(token)
              clean.append(token)
          result[category] = clean
      return result


  def main() -> None:
      parser = argparse.ArgumentParser()
      parser.add_argument("--source-dir", type=Path, required=True)
      parser.add_argument("--output", type=Path, required=True)
      args = parser.parse_args()

      modifiers = dedupe_groups(build_modifier_groups(args.source_dir))
      identities = dedupe_groups(build_identity_groups(args.source_dir))
      modifier_count = sum(map(len, modifiers.values()))
      identity_count = sum(map(len, identities.values()))
      if modifier_count < 400 or identity_count < 300:
          raise SystemExit(
              f"lexicon too small: modifier={modifier_count}, identity={identity_count}"
          )

      payload = {
          "schema_version": 1,
          "modifier_tokens": modifiers,
          "identity_tokens": identities,
      }
      args.output.parent.mkdir(parents=True, exist_ok=True)
      args.output.write_text(
          json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
          encoding="utf-8",
      )


  if __name__ == "__main__":
      main()
  ```

  `content_allowed`, `build_modifier_groups`, and `build_identity_groups` are concrete functions in this file, not imports from `backend.nickname`; the script must remain runnable without importing Redis or the FastAPI application. The curated lists must contain only public, light-hearted workplace/internet language and neutral programmer/AI vocabulary. Do not place any private review material in this script.

### Step 1.3: Generate and verify the committed artifact

- [ ] Run:

  ```bash
  python scripts/build_nickname_words.py \
    --source-dir words/THUOCL/data \
    --output backend/nickname_words.json
  python -m pytest tests/test_nickname_words.py -q
  ```

  Expected: `2 passed`.

- [ ] Run the generator a second time and prove deterministic output:

  ```bash
  sha256sum backend/nickname_words.json
  python scripts/build_nickname_words.py \
    --source-dir words/THUOCL/data \
    --output backend/nickname_words.json
  sha256sum backend/nickname_words.json
  ```

  Expected: both hashes are identical.

### Step 1.4: Preserve the source license

- [ ] Create `THIRD_PARTY_NOTICES.md` with a `THUOCL` section that states the bundled nickname artifact is derived from THUOCL and includes the complete, unmodified text from `words/THUOCL/LICENSE`, including its copyright notice.

- [ ] Confirm the runtime artifact is tracked while the raw local checkout remains ignored:

  ```bash
  git check-ignore -v words/THUOCL/data/THUOCL_IT.txt
  git check-ignore backend/nickname_words.json
  ```

  Expected: the first command reports an ignore rule; the second prints nothing and exits non-zero.

### Step 1.5: Commit Task 1

- [ ] Stage only Task 1 files and commit:

  ```bash
  git add requirements-dev.txt scripts/build_nickname_words.py \
    backend/nickname_words.json tests/test_nickname_words.py \
    THIRD_PARTY_NOTICES.md
  git commit -m "feat: bundle expanded nickname lexicon"
  ```

---

## Task 2: Replace the Runtime Nickname Loader and Preserve Atomic Claims

**Files:**

- Modify: `backend/nickname.py:1-211`
- Modify: `backend/main.py:256-303`
- Create: `tests/test_nickname.py`

**Interfaces:**

- `generate_one(rng: random.Random | module = random) -> str`
- `generate_unique(max_tries: int = 30) -> str` remains compatible.
- `stats() -> dict` returns exactly these public diagnostic keys:

  ```python
  {
      "source": "bundled" | "fallback",
      "modifier_tokens": int,
      "identity_tokens": int,
      "effective_combo_space": int,
  }
  ```

- Category weights:

  - Modifier: `idiom=0.60`, `internet_action=0.25`, `tech_tone=0.15`.
  - Identity: `internet_work=0.35`, `tech_ai=0.35`, `life_fun=0.20`, `game_easter_egg=0.10`.

### Step 2.1: Add failing unit tests for loading, weighting, fallback, format, and stats

- [ ] Create `tests/test_nickname.py`. Avoid Redis calls by testing `generate_one`, loader functions, and `stats`; monkeypatch `db.claim_nickname` only in the atomic-claim compatibility test.

  The test module must include these cases:

  ```python
  import json
  import random

  from backend import nickname


  def test_generate_one_uses_two_token_format():
      nickname._runtime_lexicon.cache_clear()
      value = nickname.generate_one(random.Random(20260721))
      left, right = value.removesuffix("鹅").split("的", maxsplit=1)
      assert left
      assert right
      assert value.endswith("鹅")


  def test_stats_reports_bundled_capacity_without_lists():
      nickname._runtime_lexicon.cache_clear()
      result = nickname.stats()
      assert result["source"] == "bundled"
      assert result["modifier_tokens"] >= 400
      assert result["identity_tokens"] >= 300
      assert result["effective_combo_space"] >= 120_000
      assert set(result) == {
          "source", "modifier_tokens", "identity_tokens", "effective_combo_space"
      }


  def test_loader_deduplicates_and_rejects_invalid_tokens(tmp_path):
      path = tmp_path / "words.json"
      path.write_text(json.dumps({
          "schema_version": 1,
          "modifier_tokens": {
              "idiom": ["全力以赴", "全力以赴", "bad token"],
              "internet_action": ["在线冲浪"],
              "tech_tone": ["并发拉满"],
          },
          "identity_tokens": {
              "internet_work": ["需求"],
              "tech_ai": ["Agent"],
              "life_fun": ["火锅"],
              "game_easter_egg": ["宝箱"],
          },
      }, ensure_ascii=False), encoding="utf-8")
      loaded = nickname._load_lexicon(path)
      assert loaded.modifiers["idiom"] == ["全力以赴"]


  def test_missing_file_uses_fallback(monkeypatch, tmp_path, caplog):
      monkeypatch.setattr(nickname, "_LEXICON_PATH", tmp_path / "missing.json")
      nickname._runtime_lexicon.cache_clear()
      result = nickname.stats()
      assert result["source"] == "fallback"
      assert "fallback" in caplog.text.lower()
      nickname._runtime_lexicon.cache_clear()


  def test_generate_unique_keeps_atomic_claim_flow(monkeypatch):
      claims = iter([False, True])
      attempted = []
      monkeypatch.setattr(
          nickname.db,
          "claim_nickname",
          lambda value: attempted.append(value) or next(claims),
      )
      value = nickname.generate_unique()
      assert value == attempted[-1]
      assert len(attempted) == 2
  ```

- [ ] Add a boundary test for `_weighted_token` using one token per category and a fake RNG with fixed `random()` values. Assert `0.59` selects modifier `idiom`, `0.60` selects `internet_action`, `0.84` selects `internet_action`, and `0.85` selects `tech_tone`. Add equivalent boundaries for the identity weights.

- [ ] Run:

  ```bash
  python -m pytest tests/test_nickname.py -q
  ```

  Expected: import, missing-interface, or assertion failures because the runtime still uses the old THUOCL loader.

### Step 2.2: Implement the bundled runtime loader

- [ ] Rewrite `backend/nickname.py` around these concrete structures:

  ```python
  from __future__ import annotations

  import json
  import logging
  import random
  import re
  import string
  from dataclasses import dataclass
  from functools import lru_cache
  from pathlib import Path
  from typing import Mapping, Protocol, Sequence

  from . import db

  logger = logging.getLogger(__name__)
  _LEXICON_PATH = Path(__file__).with_name("nickname_words.json")
  _TOKEN_RE = re.compile(r"^[A-Za-z0-9\u4e00-\u9fff.+#_-]{1,12}$")

  MODIFIER_WEIGHTS = (
      ("idiom", 0.60),
      ("internet_action", 0.25),
      ("tech_tone", 0.15),
  )
  IDENTITY_WEIGHTS = (
      ("internet_work", 0.35),
      ("tech_ai", 0.35),
      ("life_fun", 0.20),
      ("game_easter_egg", 0.10),
  )


  class RandomSource(Protocol):
      def random(self) -> float: ...
      def choice(self, values: Sequence[str]) -> str: ...


  @dataclass(frozen=True)
  class Lexicon:
      modifiers: dict[str, list[str]]
      identities: dict[str, list[str]]
      source: str
  ```

- [ ] Implement `_validated_groups(raw, expected_categories)` so it:

  - rejects missing/non-list categories with `ValueError`;
  - strips tokens;
  - calls the existing project content predicate;
  - deduplicates across categories, first category winning;
  - rejects an empty category after validation.

- [ ] Implement `_load_lexicon(path: Path) -> Lexicon` to validate `schema_version == 1` and the exact category sets. It returns `source="bundled"` for a valid file.

- [ ] Add a small built-in fallback containing at least three tokens per category. Implement the cache and degraded logging exactly once per cache lifetime:

  ```python
  @lru_cache(maxsize=1)
  def _runtime_lexicon() -> Lexicon:
      try:
          return _load_lexicon(_LEXICON_PATH)
      except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
          logger.warning(
              "nickname lexicon unavailable; using fallback (%s)",
              type(exc).__name__,
          )
          return _fallback_lexicon()
  ```

- [ ] Implement weighted selection without relying on category list size:

  ```python
  def _weighted_token(
      groups: Mapping[str, Sequence[str]],
      weights: Sequence[tuple[str, float]],
      rng: RandomSource,
  ) -> str:
      point = rng.random()
      cumulative = 0.0
      for index, (category, weight) in enumerate(weights):
          cumulative += weight
          if point < cumulative or index == len(weights) - 1:
              return rng.choice(groups[category])
      raise AssertionError("unreachable")


  def generate_one(rng: RandomSource = random) -> str:
      lexicon = _runtime_lexicon()
      modifier = _weighted_token(lexicon.modifiers, MODIFIER_WEIGHTS, rng)
      identity = _weighted_token(lexicon.identities, IDENTITY_WEIGHTS, rng)
      return f"{modifier}的{identity}鹅"
  ```

- [ ] Preserve the current `generate_unique` retry/suffix behavior and Redis `claim_nickname` calls. Do not move claiming into `peek`.

- [ ] Implement `stats` from distinct runtime tokens:

  ```python
  def stats() -> dict:
      lexicon = _runtime_lexicon()
      modifier_count = sum(len(values) for values in lexicon.modifiers.values())
      identity_count = sum(len(values) for values in lexicon.identities.values())
      return {
          "source": lexicon.source,
          "modifier_tokens": modifier_count,
          "identity_tokens": identity_count,
          "effective_combo_space": modifier_count * identity_count,
      }
  ```

- [ ] Update only the nickname route docstrings in `backend/main.py` so they describe the generic two-token format rather than the old category names. Keep paths and response contracts unchanged.

### Step 2.3: Verify runtime behavior

- [ ] Run:

  ```bash
  python -m pytest tests/test_nickname.py tests/test_nickname_words.py -q
  python - <<'PY'
  from backend.nickname import generate_one, stats
  values = [generate_one() for _ in range(1000)]
  assert len(set(values)) >= 950
  print(stats())
  PY
  ```

  Expected: all Python tests pass; stats reports `source='bundled'`, at least 400 modifier tokens, at least 300 identity tokens, and at least 120,000 combinations. The 1,000-sample smoke check yields at least 950 distinct names.

### Step 2.4: Commit Task 2

- [ ] Stage and commit:

  ```bash
  git add backend/nickname.py backend/main.py tests/test_nickname.py
  git commit -m "feat: generate weighted two-token nicknames"
  ```

---

## Task 3: Avoid Repeating the Last 30 Browser Nickname Candidates

**Files:**

- Create: `frontend/nickname-history.js`
- Create: `tests/frontend/nickname-history.test.cjs`
- Modify: `frontend/index.html:150-151`
- Modify: `frontend/app.js:41-126`

**Interfaces:**

- Browser global and CommonJS export `NicknameHistory`:

  ```javascript
  {
    load(storage, key, limit),
    remember(storage, name, key, limit),
    fetchFresh(fetchCandidate, recent, maxAttempts)
  }
  ```

- Storage key: `ic_nick_recent`.
- History limit: `30`.
- Maximum server preview attempts per click: `8`.

### Step 3.1: Add failing JavaScript tests

- [ ] Create `tests/frontend/nickname-history.test.cjs` using only `node:test` and `node:assert/strict`. Cover:

  - corrupt local-storage JSON returns `[]`;
  - `remember` keeps newest-first unique names and truncates to 30;
  - `fetchFresh` retries recent names and returns the first unseen name;
  - `fetchFresh` makes at most eight calls and returns the eighth result if every result is recent;
  - storage read/write exceptions do not break the flow.

  Use this in-memory storage in the test:

  ```javascript
  function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
    };
  }
  ```

- [ ] Run:

  ```bash
  node --test tests/frontend/nickname-history.test.cjs
  ```

  Expected: failure with `MODULE_NOT_FOUND` for `frontend/nickname-history.js`.

### Step 3.2: Implement the pure history helper

- [ ] Create `frontend/nickname-history.js` as a browser/CommonJS-compatible IIFE. Its behavior must match:

  ```javascript
  (function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.NicknameHistory = api;
  })(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function load(storage, key = "ic_nick_recent", limit = 30) {
      try {
        const parsed = JSON.parse(storage.getItem(key) || "[]");
        if (!Array.isArray(parsed)) return [];
        return [...new Set(parsed.filter(value => typeof value === "string" && value))]
          .slice(0, limit);
      } catch (_) {
        return [];
      }
    }

    function remember(storage, name, key = "ic_nick_recent", limit = 30) {
      const updated = [name, ...load(storage, key, limit)]
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .slice(0, limit);
      try { storage.setItem(key, JSON.stringify(updated)); } catch (_) {}
      return updated;
    }

    async function fetchFresh(fetchCandidate, recent, maxAttempts = 8) {
      const seen = new Set(recent);
      let candidate = "";
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        candidate = await fetchCandidate();
        if (!seen.has(candidate)) return candidate;
      }
      return candidate;
    }

    return { load, remember, fetchFresh };
  });
  ```

### Step 3.3: Wire history into the existing modal

- [ ] In `frontend/index.html`, load the helper before `app.js`:

  ```html
  <script src="/effects.js"></script>
  <script src="/nickname-history.js"></script>
  <script src="/app.js"></script>
  ```

- [ ] In `frontend/app.js`, update `peek()` so one reroll performs at most eight `/api/nickname/peek` calls, rejects any name found in the last 30 candidates, remembers the chosen preview immediately, and retains the current offline fallback:

  ```javascript
  const NICK_RECENT_KEY = "ic_nick_recent";
  const NICK_RECENT_LIMIT = 30;
  const NICK_PEEK_ATTEMPTS = 8;

  async function requestNicknameCandidate() {
    const response = await fetch("/api/nickname/peek");
    if (!response.ok) throw new Error(`nickname peek failed: ${response.status}`);
    const payload = await response.json();
    if (!payload.nickname) throw new Error("nickname peek returned no nickname");
    return payload.nickname;
  }
  ```

  Inside `peek()`:

  ```javascript
  const recent = NicknameHistory.load(
    localStorage,
    NICK_RECENT_KEY,
    NICK_RECENT_LIMIT,
  );
  candidate = await NicknameHistory.fetchFresh(
    requestNicknameCandidate,
    recent,
    NICK_PEEK_ATTEMPTS,
  );
  NicknameHistory.remember(
    localStorage,
    candidate,
    NICK_RECENT_KEY,
    NICK_RECENT_LIMIT,
  );
  previewEl.textContent = candidate;
  ```

- [ ] Do not change claim semantics: preview remains unclaimed; clicking confirm still calls `/api/nickname/claim` once.

### Step 3.4: Verify and commit Task 3

- [ ] Run:

  ```bash
  node --test tests/frontend/nickname-history.test.cjs
  python -m pytest tests/test_nickname.py tests/test_nickname_words.py -q
  ```

  Expected: all tests pass.

- [ ] Stage and commit:

  ```bash
  git add frontend/nickname-history.js frontend/index.html frontend/app.js \
    tests/frontend/nickname-history.test.cjs
  git commit -m "feat: avoid recent nickname previews"
  ```

---

## Task 4: Enforce Lightweight Development/Production/Test Data Isolation

**Files:**

- Create: `backend/settings.py`
- Create: `tests/test_settings.py`
- Modify: `backend/main.py:30-58`
- Modify: `backend/db.py:26`
- Modify: `docker-compose.yml:19-33`
- Modify: `.env.example:1-10`

**Interfaces:**

- Environment mapping: `dev -> Redis DB 1`, `prod -> Redis DB 0`, `test -> Redis DB 2`.
- SQLite remains `data/{APP_ENV}.db` through the existing `backend/archive.py` implementation.
- `ALLOW_CUSTOM_REDIS_DB=1` permits an intentional non-standard Redis DB index.
- `validate_runtime_environment() -> RuntimeEnvironment` raises `RuntimeError` before connecting if configuration is invalid.

### Step 4.1: Add failing settings tests

- [ ] Create `tests/test_settings.py`:

  ```python
  import pytest

  from backend.settings import redis_db_index, validate_runtime_environment


  @pytest.mark.parametrize(
      ("url", "expected"),
      [
          ("redis://localhost:6379", 0),
          ("redis://localhost:6379/0", 0),
          ("redis://localhost:6379/1", 1),
          ("rediss://user:pass@example.com:6380/2", 2),
      ],
  )
  def test_redis_db_index(url, expected):
      assert redis_db_index(url) == expected


  @pytest.mark.parametrize(
      ("app_env", "url", "expected_db"),
      [
          ("dev", "redis://localhost:6379/1", 1),
          ("prod", "redis://localhost:6379/0", 0),
          ("test", "redis://localhost:6379/2", 2),
      ],
  )
  def test_matching_environment_is_accepted(app_env, url, expected_db):
      result = validate_runtime_environment(app_env, url, allow_custom=False)
      assert result.app_env == app_env
      assert result.redis_db == expected_db


  def test_unknown_environment_is_rejected():
      with pytest.raises(RuntimeError, match="APP_ENV"):
          validate_runtime_environment("staging", "redis://localhost:6379/1", False)


  def test_mismatched_database_is_rejected():
      with pytest.raises(RuntimeError, match="Redis DB"):
          validate_runtime_environment("prod", "redis://localhost:6379/1", False)


  def test_explicit_override_allows_custom_database():
      result = validate_runtime_environment("prod", "redis://localhost:6379/7", True)
      assert result.redis_db == 7


  @pytest.mark.parametrize("url", ["not-a-url", "http://localhost/1", "redis://localhost/x"])
  def test_invalid_redis_url_is_rejected(url):
      with pytest.raises(RuntimeError, match="REDIS_URL"):
          redis_db_index(url)
  ```

- [ ] Run:

  ```bash
  python -m pytest tests/test_settings.py -q
  ```

  Expected: import failure because `backend/settings.py` does not exist.

### Step 4.2: Implement pure settings validation

- [ ] Create `backend/settings.py`:

  ```python
  from __future__ import annotations

  import os
  from dataclasses import dataclass
  from urllib.parse import urlparse

  EXPECTED_REDIS_DBS = {"dev": 1, "prod": 0, "test": 2}
  DEFAULT_REDIS_URL = "redis://127.0.0.1:16739/1"


  @dataclass(frozen=True)
  class RuntimeEnvironment:
      app_env: str
      redis_db: int


  def redis_db_index(url: str) -> int:
      try:
          parsed = urlparse(url)
          if parsed.scheme not in {"redis", "rediss"} or not parsed.hostname:
              raise ValueError
          path = parsed.path.strip("/")
          return 0 if not path else int(path)
      except (TypeError, ValueError) as exc:
          raise RuntimeError("REDIS_URL must be a valid redis:// or rediss:// URL") from exc


  def validate_runtime_environment(
      app_env: str | None = None,
      redis_url: str | None = None,
      allow_custom: bool | None = None,
  ) -> RuntimeEnvironment:
      selected_env = (app_env or os.getenv("APP_ENV", "dev")).strip().lower()
      if selected_env not in EXPECTED_REDIS_DBS:
          raise RuntimeError("APP_ENV must be one of: dev, prod, test")

      selected_url = redis_url or os.getenv("REDIS_URL", DEFAULT_REDIS_URL)
      selected_db = redis_db_index(selected_url)
      override = allow_custom
      if override is None:
          override = os.getenv("ALLOW_CUSTOM_REDIS_DB", "0") == "1"
      expected_db = EXPECTED_REDIS_DBS[selected_env]
      if not override and selected_db != expected_db:
          raise RuntimeError(
              f"APP_ENV={selected_env} requires Redis DB {expected_db}; got DB {selected_db}"
          )
      return RuntimeEnvironment(selected_env, selected_db)
  ```

- [ ] Change `backend/db.py` to use the same safe default:

  ```python
  from .settings import DEFAULT_REDIS_URL

  REDIS_URL = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)
  ```

- [ ] In `backend/main.py`, import `validate_runtime_environment` and call it as the first line of `_startup`, before `db.init_db()`. Log only the selected environment and Redis DB index; never log the Redis URL, credentials, query string, or environment-variable values other than `APP_ENV` and the numeric DB index:

  ```python
  runtime = validate_runtime_environment()
  print(f"[env] APP_ENV={runtime.app_env} Redis DB={runtime.redis_db}")
  ```

- [ ] Remove the later duplicate `APP_ENV`/`REDIS_URL` diagnostic lines in `_startup`.

### Step 4.3: Fix Docker Compose defaults and SQLite persistence

- [ ] Change the `web` service in `docker-compose.yml` to:

  ```yaml
  web:
    build: .
    image: infinity-craft:latest
    container_name: infinity-craft
    depends_on:
      - redis
    ports:
      - "8000:8000"
    environment:
      APP_ENV: "${APP_ENV:-dev}"
      REDIS_URL: "${REDIS_URL:-redis://redis:6379/1}"
      ALLOW_CUSTOM_REDIS_DB: "${ALLOW_CUSTOM_REDIS_DB:-0}"
      GLM_API_URL: "${GLM_API_URL:-}"
      GLM_TIMEOUT: "${GLM_TIMEOUT:-15}"
      GLM_MAX_RETRIES: "${GLM_MAX_RETRIES:-2}"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
  ```

- [ ] Update `.env.example` for Docker Compose defaults:

  ```dotenv
  APP_ENV=dev
  REDIS_URL=redis://redis:6379/1
  ALLOW_CUSTOM_REDIS_DB=0
  HOST=0.0.0.0
  PORT=8000

  GLM_API_URL=
  GLM_TIMEOUT=10
  GLM_MAX_RETRIES=2
  ```

  Add comments explaining that production must change both `APP_ENV=prod` and the Redis URL suffix to `/0`, while test uses `/2`. Do not include credentials or real endpoints.

### Step 4.4: Verify settings and resolved Compose configuration

- [ ] Run:

  ```bash
  python -m pytest tests/test_settings.py -q
  docker compose config
  APP_ENV=prod REDIS_URL=redis://redis:6379/0 docker compose config
  ```

  Expected: settings tests pass; default Compose output contains `APP_ENV: dev`, `REDIS_URL: redis://redis:6379/1`, and the `/app/data` bind; production-resolved output contains `APP_ENV: prod` and Redis DB `/0`.

### Step 4.5: Commit Task 4

- [ ] Stage and commit:

  ```bash
  git add backend/settings.py backend/main.py backend/db.py \
    docker-compose.yml .env.example tests/test_settings.py
  git commit -m "fix: isolate development and production data"
  ```

---

## Task 5: Document the Minimal Architecture and Run End-to-End Verification

**Files:**

- Modify: `README.md:23-30,62-86,123-143`
- Modify: `backend/README.md` only if its nickname extension instructions still describe the removed runtime THUOCL dependency.

**Interfaces:** None. This task documents existing behavior and verifies the deployable artifact.

### Step 5.1: Update the operator documentation

- [ ] Update `README.md` to state:

  - the app intentionally remains one FastAPI service plus Redis and SQLite;
  - Docker persists SQLite and Redis under `./data`;
  - local/Docker development defaults to `APP_ENV=dev`, Redis DB 1, and `data/dev.db`;
  - production uses `APP_ENV=prod`, Redis DB 0, and `data/prod.db`;
  - test uses DB 2 and `data/test.db`;
  - the service refuses mismatched environment/Redis DB configuration unless `ALLOW_CUSTOM_REDIS_DB=1` is explicitly set;
  - database administration remains script-based through `reset.sh`; there is no public write-capable database API;
  - the nickname runtime reads `backend/nickname_words.json`, while `scripts/build_nickname_words.py` is the deterministic maintenance tool;
  - `/api/nickname/stats` reports only source and capacity metadata.

- [ ] Correct the directory tree so it lists `archive.py`, `nickname.py`, `nickname_words.json`, `settings.py`, and `data/{dev|prod|test}.db` accurately.

### Step 5.2: Run the complete automated test suite

- [ ] Run:

  ```bash
  python -m pytest -q
  node --test tests/frontend/nickname-history.test.cjs
  ```

  Expected: all tests pass, with no warnings caused by project code.

### Step 5.3: Build and smoke-test the production image in default development mode

- [ ] Build and start:

  ```bash
  docker compose up --build -d
  docker compose ps
  ```

  Expected: Redis and web are running; web binds port 8000.

- [ ] Check logs without printing secrets:

  ```bash
  docker compose logs --tail=120 web
  ```

  Expected: startup reports `APP_ENV=dev`, Redis DB 1, and `data/dev.db`; no fallback lexicon warning appears.

- [ ] Check health and nickname diagnostics:

  ```bash
  curl --fail --silent http://localhost:8000/api/health
  curl --fail --silent http://localhost:8000/api/nickname/stats
  curl --fail --silent http://localhost:8000/api/nickname/peek
  ```

  Expected: health is successful; nickname stats report `source=bundled` and capacity of at least 120,000; peek matches the two-token format.

- [ ] Prove the image contains the lexicon and the container uses the persistent SQLite mount:

  ```bash
  docker compose exec -T web test -f /app/backend/nickname_words.json
  docker compose exec -T web test -f /app/data/dev.db
  docker inspect infinity-craft --format '{{json .Mounts}}'
  ```

  Expected: both files exist and `/app/data` is a bind mount from the project `data` directory.

### Step 5.4: Verify data survives a web-container recreation

- [ ] Record the SQLite size, recreate only the web service, and verify the file still exists and does not shrink unexpectedly:

  ```bash
  before_size=$(stat -c %s data/dev.db)
  docker compose up -d --force-recreate web
  after_size=$(stat -c %s data/dev.db)
  test "$after_size" -ge "$before_size"
  curl --fail --silent http://localhost:8000/api/health
  ```

  Expected: the size assertion and health request succeed. Do not flush Redis or delete any database during this verification.

### Step 5.5: Verify the safety guard rejects a mismatched production database

- [ ] Run an isolated one-off container without changing the running service:

  ```bash
  docker compose run --rm --no-deps \
    -e APP_ENV=prod \
    -e REDIS_URL=redis://redis:6379/1 \
    web python -c 'from backend.settings import validate_runtime_environment; validate_runtime_environment()'
  ```

  Expected: non-zero exit with a message that production requires Redis DB 0. The output must not contain credentials.

### Step 5.6: Review repository hygiene and commit documentation

- [ ] Run:

  ```bash
  git status --short
  git diff --check
  git ls-files | rg '(^|/)(\.env($|\.)|.*\.db$|dump\.rdb$|appendonly\.aof$|data/backup/)'
  rg -n 'TODO|TBD|PLACEHOLDER' \
    backend/settings.py backend/nickname.py frontend/nickname-history.js \
    tests scripts/build_nickname_words.py README.md
  ```

  Expected: `git diff --check` is clean; the tracked-file scan prints nothing; the placeholder scan prints nothing. `CLAUDE.md` may remain untracked and must not be staged.

- [ ] Stage only documentation and commit:

  ```bash
  git add README.md backend/README.md
  git commit -m "docs: explain nickname and data environments"
  ```

  If `backend/README.md` required no change, omit it from `git add`.

- [ ] Confirm final state:

  ```bash
  git status --short --branch
  git log --oneline -7
  ```

  Expected: only the user's pre-existing untracked `CLAUDE.md` remains; the new task commits are visible on top of the current local branch. Do not push until the user requests or confirms the final reviewed state.

---

## Self-Review Checklist

- [ ] Every requirement from `docs/superpowers/specs/2026-07-21-nickname-and-environment-design.md` maps to a task above.
- [ ] Both token positions have independent explicit category weights.
- [ ] The production image has no dependency on ignored source corpora.
- [ ] Preview history deduplication is browser-local and does not consume global nickname claims.
- [ ] Global uniqueness still uses the existing atomic Redis operation.
- [ ] Development, production, and test each use separate Redis DB indexes and SQLite filenames.
- [ ] Docker persists SQLite to the host.
- [ ] No new database control API or extra infrastructure was introduced.
- [ ] Unit, JavaScript, Compose-resolution, Docker, persistence, and misconfiguration checks are specified.
- [ ] Third-party attribution is retained.
- [ ] No secrets, private endpoints, review notes, runtime data, or the user's `CLAUDE.md` are staged.
- [ ] All code examples use concrete names and compatible return types; no implementation placeholders remain.

## Execution Choice

1. **Subagent-Driven (recommended):** Explicitly authorize parallel agents; execute one task at a time with review between tasks.
2. **Inline Execution:** Execute this plan in the current session sequentially, using the required executing-plans workflow and the same review checkpoints.
