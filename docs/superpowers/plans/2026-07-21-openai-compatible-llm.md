# OpenAI-Compatible LLM Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the retired custom GLM request with one OpenAI-compatible chat-completions adapter, configure EdgeOne Makers locally, and allow provider switching through environment variables only.

**Architecture:** Preserve `backend.prompt`'s `query({"question": ...}, temperature)` contract and translate it inside `backend/llm.py` to chat completions. Read provider settings from ignored local or deployment environment variables, return assistant content as `{"text": ...}`, and retain the existing `None` fallback. Health reports configuration state without calling the model.

**Tech Stack:** Python 3.11, `openai`, `python-dotenv`, FastAPI, pytest, Docker Compose.

## Global Constraints

- Never place the real credential in source, tests, documentation, output, Git staging, commits, or Docker image layers.
- Keep the credential only in ignored root `.env` or deployment-platform secret settings.
- Credential precedence is `LLM_API_KEY`, then `MAKERS_MODELS_KEY`.
- Required settings are one credential, `LLM_BASE_URL`, and `LLM_MODEL`; defaults are `LLM_TIMEOUT=15` and `LLM_MAX_RETRIES=2`.
- Preserve `backend.llm.query(payload, temperature) -> dict | None` and the game's existing fallback behavior.
- Do not log exception bodies, prompts, credentials, headers, full base URLs, or provider responses.
- Do not call the model from `/api/health`.
- Do not change prompts, combination rules, caches, first-discovery semantics, Redis, or SQLite.
- Do not edit or stage the user's untracked `CLAUDE.md`.

---

## Task 1: Implement and Unit-Test the Adapter

**Files:**

- Create: `requirements-dev.txt`
- Create: `tests/test_llm.py`
- Modify: `requirements.txt:1-6`
- Replace: `backend/llm.py:1-65`

**Interfaces:**

- Produces: `LLMSettings.from_env() -> LLMSettings`
- Produces: `LLMSettings.is_configured -> bool`
- Produces: `configuration_status() -> Literal["configured", "not_configured"]`
- Preserves: `query(payload: dict[str, Any], temperature: float | None = None) -> dict[str, Any] | None`
- Test seam: keyword-only `_client_factory: Callable[..., Any] = OpenAI`

- [ ] **Step 1: Declare dependencies**

Append to `requirements.txt`:

```text
openai>=1.0,<3
python-dotenv>=1.0,<2
```

Create `requirements-dev.txt`:

```text
-r requirements.txt
pytest>=8,<9
```

- [ ] **Step 2: Write failing adapter tests**

Create `tests/test_llm.py`:

```python
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend import llm


ENV_NAMES = (
    "LLM_API_KEY", "MAKERS_MODELS_KEY", "LLM_BASE_URL", "LLM_MODEL",
    "LLM_TIMEOUT", "LLM_MAX_RETRIES",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def configure(monkeypatch, generic_key="", makers_key="makers-test-key"):
    monkeypatch.setenv("LLM_API_KEY", generic_key)
    monkeypatch.setenv("MAKERS_MODELS_KEY", makers_key)
    monkeypatch.setenv("LLM_BASE_URL", "https://gateway.test/v1")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    monkeypatch.setenv("LLM_TIMEOUT", "12.5")
    monkeypatch.setenv("LLM_MAX_RETRIES", "3")


def fake_factory(content='{"name":"云朵","emoji":"☁️"}', error=None):
    captured = {"init": None, "create": None}

    class Completions:
        def create(self, **kwargs):
            captured["create"] = kwargs
            if error:
                raise error
            if content is None:
                return SimpleNamespace(choices=[])
            message = SimpleNamespace(content=content)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    class Client:
        def __init__(self):
            self.chat = SimpleNamespace(completions=Completions())

    def factory(**kwargs):
        captured["init"] = kwargs
        return Client()

    return factory, captured


def test_generic_key_precedence_and_request_mapping(monkeypatch):
    configure(monkeypatch, generic_key="generic-test-key")
    factory, captured = fake_factory()
    result = llm.query(
        {"question": "咖啡 + 代码"}, temperature=0.42,
        _client_factory=factory,
    )
    assert result == {"text": '{"name":"云朵","emoji":"☁️"}'}
    assert captured["init"] == {
        "api_key": "generic-test-key",
        "base_url": "https://gateway.test/v1",
        "timeout": 12.5,
        "max_retries": 3,
    }
    assert captured["create"] == {
        "model": "test-model",
        "messages": [{"role": "user", "content": "咖啡 + 代码"}],
        "temperature": 0.42,
    }


def test_makers_key_fallback_and_optional_temperature(monkeypatch):
    configure(monkeypatch)
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory)
    assert captured["init"]["api_key"] == "makers-test-key"
    assert "temperature" not in captured["create"]


@pytest.mark.parametrize(
    "missing", ["MAKERS_MODELS_KEY", "LLM_BASE_URL", "LLM_MODEL"]
)
def test_incomplete_configuration_returns_none(monkeypatch, missing):
    configure(monkeypatch)
    monkeypatch.delenv(missing)
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory) is None
    assert captured["init"] is None


@pytest.mark.parametrize("payload", [{}, {"question": ""}, {"question": 123}])
def test_invalid_question_returns_none(monkeypatch, payload):
    configure(monkeypatch)
    factory, captured = fake_factory()
    assert llm.query(payload, _client_factory=factory) is None
    assert captured["init"] is None


def test_empty_completion_returns_none(monkeypatch):
    configure(monkeypatch)
    factory, _ = fake_factory(content=None)
    assert llm.query({"question": "ping"}, _client_factory=factory) is None


def test_provider_error_is_redacted(monkeypatch, capsys):
    configure(monkeypatch, makers_key="do-not-print-this-key")
    factory, _ = fake_factory(error=RuntimeError("private provider body"))
    assert llm.query({"question": "private prompt"}, _client_factory=factory) is None
    output = capsys.readouterr().out
    assert "RuntimeError" in output
    assert "do-not-print-this-key" not in output
    assert "provider body" not in output
    assert "private prompt" not in output


def test_configuration_status(monkeypatch):
    assert llm.configuration_status() == "not_configured"
    configure(monkeypatch)
    assert llm.configuration_status() == "configured"
    monkeypatch.setenv("LLM_TIMEOUT", "invalid")
    assert llm.configuration_status() == "not_configured"
```

- [ ] **Step 3: Verify the tests fail against the legacy adapter**

Run: `python -m pytest tests/test_llm.py -q`

Expected: failures because `_client_factory` and `configuration_status` do not exist and the adapter still reads `GLM_API_URL`.

- [ ] **Step 4: Replace `backend/llm.py`**

```python
"""Provider-neutral OpenAI-compatible LLM transport."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


@dataclass(frozen=True)
class LLMSettings:
    api_key: str
    base_url: str
    model: str
    timeout: float
    max_retries: int

    @classmethod
    def from_env(cls) -> "LLMSettings":
        api_key = (
            os.getenv("LLM_API_KEY", "").strip()
            or os.getenv("MAKERS_MODELS_KEY", "").strip()
        )
        timeout = float(os.getenv("LLM_TIMEOUT", "15"))
        max_retries = int(os.getenv("LLM_MAX_RETRIES", "2"))
        if timeout <= 0 or max_retries < 0:
            raise ValueError("invalid timeout or retry configuration")
        return cls(
            api_key=api_key,
            base_url=os.getenv("LLM_BASE_URL", "").strip().rstrip("/"),
            model=os.getenv("LLM_MODEL", "").strip(),
            timeout=timeout,
            max_retries=max_retries,
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)


def configuration_status() -> Literal["configured", "not_configured"]:
    try:
        settings = LLMSettings.from_env()
    except (TypeError, ValueError):
        return "not_configured"
    return "configured" if settings.is_configured else "not_configured"


def query(
    payload: dict[str, Any],
    temperature: Optional[float] = None,
    *,
    _client_factory: Callable[..., Any] = OpenAI,
) -> Optional[dict[str, Any]]:
    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        print("[llm] invalid question payload; using fallback")
        return None
    try:
        settings = LLMSettings.from_env()
    except (TypeError, ValueError):
        print("[llm] invalid configuration; using fallback")
        return None
    if not settings.is_configured:
        print("[llm] provider is not configured; using fallback")
        return None

    request: dict[str, Any] = {
        "model": settings.model,
        "messages": [{"role": "user", "content": question}],
    }
    if temperature is not None:
        request["temperature"] = float(temperature)
    try:
        client = _client_factory(
            api_key=settings.api_key,
            base_url=settings.base_url,
            timeout=settings.timeout,
            max_retries=settings.max_retries,
        )
        completion = client.chat.completions.create(**request)
        choices = getattr(completion, "choices", None)
        if not choices:
            return None
        content = getattr(getattr(choices[0], "message", None), "content", None)
        if not isinstance(content, str) or not content.strip():
            return None
        return {"text": content}
    except Exception as exc:
        print(f"[llm] query failed: {type(exc).__name__}")
        return None
```

- [ ] **Step 5: Install and verify**

Run:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest tests/test_llm.py -q
python - <<'PY'
from backend.prompt import parse_response
wire = {"text": '{"name":"云朵","emoji":"☁️"}'}
assert parse_response(wire["text"]) == {"name": "云朵", "emoji": "☁️"}
print("prompt adapter contract: ok")
PY
```

Expected: all adapter tests pass and the contract script prints `prompt adapter contract: ok`.

- [ ] **Step 6: Commit Task 1**

```bash
git add requirements.txt requirements-dev.txt backend/llm.py tests/test_llm.py
git commit -m "feat: add openai-compatible llm adapter"
```

---

## Task 2: Wire Health, Compose, Examples, and Documentation

**Files:**

- Modify: `backend/main.py:1-12,118-137,345-347,406-407`
- Modify: `backend/prompt.py:302-305,339-361`
- Modify: `docker-compose.yml:27-33`
- Modify: `.env.example:7-10`
- Modify: `README.md:38-58,134-143`
- Modify: `tests/test_llm.py`

**Interfaces:**

- Consumes: `configuration_status() -> "configured" | "not_configured"`
- Produces: `/api/health` field `llm`, replacing `glm`
- Preserves: `/api/combine` source values `seed | llm | fallback`

- [ ] **Step 1: Add a failing health test**

Append to `tests/test_llm.py`:

```python
def test_health_reports_configuration_without_model_call(monkeypatch):
    import asyncio
    from backend import main

    configure(monkeypatch)

    class FakeRedis:
        def ping(self): return True
        def dbsize(self): return 7

    def forbidden_query(*args, **kwargs):
        raise AssertionError("health must not call the model")

    monkeypatch.setattr(main.db, "get_client", lambda: FakeRedis())
    monkeypatch.setattr(llm, "query", forbidden_query)
    result = asyncio.run(main.api_health())
    assert result["redis"] == "ok"
    assert result["redis_dbsize"] == 7
    assert result["llm"] == "configured"
    assert "glm" not in result
```

- [ ] **Step 2: Verify the health test fails**

Run: `python -m pytest tests/test_llm.py::test_health_reports_configuration_without_model_call -q`

Expected: failure because the endpoint uses `glm` and invokes `query`.

- [ ] **Step 3: Replace the health function**

```python
@app.get("/api/health")
async def api_health():
    """Report dependencies and LLM configuration without billing a model call."""
    from .llm import configuration_status

    out = {
        "redis": "?",
        "llm": configuration_status(),
        "redis_dbsize": 0,
        "sqlite": archive.db_path_str(),
        "app_env": os.environ.get("APP_ENV", "dev"),
    }
    try:
        c = db.get_client()
        c.ping()
        out["redis"] = "ok"
        out["redis_dbsize"] = c.dbsize()
    except Exception as exc:
        out["redis"] = f"error: {type(exc).__name__}"
    return out
```

Change only nearby provider-specific docstrings/comments from `GLM` to `LLM`. Do not change prompt contents or route contracts.

- [ ] **Step 4: Replace Compose and example variables**

Replace the `GLM_*` lines in `docker-compose.yml` with:

```yaml
      LLM_API_KEY: "${LLM_API_KEY:-}"
      MAKERS_MODELS_KEY: "${MAKERS_MODELS_KEY:-}"
      LLM_BASE_URL: "${LLM_BASE_URL:-}"
      LLM_MODEL: "${LLM_MODEL:-}"
      LLM_TIMEOUT: "${LLM_TIMEOUT:-15}"
      LLM_MAX_RETRIES: "${LLM_MAX_RETRIES:-2}"
```

Replace the LLM section of `.env.example` with:

```dotenv
# OpenAI-compatible provider. Keep real credentials in ignored .env only.
LLM_API_KEY=
MAKERS_MODELS_KEY=
LLM_BASE_URL=https://ai-gateway.edgeone.link/v1
LLM_MODEL=@makers/deepseek-v4-flash
LLM_TIMEOUT=15
LLM_MAX_RETRIES=2
```

- [ ] **Step 5: Update README**

Update `README.md` to name an `OpenAI-compatible LLM API`, document all six variables, state key precedence, explain Makers/external switching, state that health is non-billable, and direct deployment users to EdgeOne project environment settings. Use empty credential examples only.

- [ ] **Step 6: Verify and commit Task 2**

Run:

```bash
python -m pytest tests/test_llm.py -q
docker compose config --quiet
git diff --check
git grep -n -E 'GLM_API_URL|GLM_TIMEOUT|GLM_MAX_RETRIES' -- . ':!docs/superpowers/**'
```

Expected: tests and checks pass; the legacy scan prints nothing.

Commit:

```bash
git add backend/main.py backend/prompt.py docker-compose.yml .env.example README.md tests/test_llm.py
git commit -m "chore: configure provider-neutral llm settings"
```

---

## Task 3: Configure the Ignored Makers Secret and Verify Live

**Files:**

- Create locally, never stage: `.env`
- No tracked file changes.

**Interfaces:** Consumes the five Makers settings and produces a verified local/live configuration.

- [ ] **Step 1: Verify ignore protection before writing**

Run:

```bash
git check-ignore -v .env
git ls-files --error-unmatch .env
```

Expected: the first reports `.gitignore`; the second exits non-zero. Stop if `.env` is tracked.

- [ ] **Step 2: Create `.env` without echoing it**

Use `apply_patch` to create `.env` with the user-supplied credential as the `MAKERS_MODELS_KEY` value and these exact non-secret values:

```dotenv
LLM_BASE_URL=https://ai-gateway.edgeone.link/v1
LLM_MODEL=@makers/deepseek-v4-flash
LLM_TIMEOUT=15
LLM_MAX_RETRIES=2
```

Do not add `LLM_API_KEY`; never display the resulting file or put the credential in a shell command.

- [ ] **Step 3: Verify ignore and scan Git without displaying matches**

Run:

```bash
git status --ignored --short .env
git ls-files --error-unmatch .env
if git grep -q -E 'sk-[A-Za-z0-9]{20,}'; then exit 1; fi
if git log -p --all | rg -q 'sk-[A-Za-z0-9]{20,}'; then exit 1; fi
```

Expected: status shows `!! .env`; `git ls-files` fails; both secret scans succeed silently.

- [ ] **Step 4: Verify configuration and one low-token live request**

```bash
python - <<'PY'
from backend.llm import configuration_status, query
assert configuration_status() == "configured"
result = query({"question": "Reply with exactly: OK"}, temperature=0)
assert result and isinstance(result.get("text"), str) and result["text"].strip()
print("makers live request: ok")
PY
```

Expected: `makers live request: ok`; do not print the response or settings.

- [ ] **Step 5: Build and smoke-test Docker**

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl --fail --silent http://localhost:8000/api/health
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"a":"咖啡","b":"代码","discoverer":"测试鹅","session_id":"llm-smoke"}' \
  http://localhost:8000/api/combine
```

Expected: services run; health contains `"llm":"configured"`; combine returns source `seed` or `llm`. If cached, use one neutral uncached pair to verify `llm` without private content.

- [ ] **Step 6: Final verification; do not commit `.env`**

```bash
python -m pytest -q
docker compose logs --tail=120 web
git diff --check
git status --short --branch
git log --oneline -5
```

Expected: tests pass; logs reveal no credential, prompt, header, or response; implementation commits exist; `.env` remains ignored; `CLAUDE.md` remains unrelated and untracked. This task has no commit.

---

## Self-Review Checklist

- [ ] Every design requirement maps to a task.
- [ ] Adapter, tests, and parser use consistent `query` and `{"text": ...}` contracts.
- [ ] Generic/Makers key precedence and failure paths are tested.
- [ ] Health is generic and non-billable.
- [ ] Compose and `.env.example` use identical provider names.
- [ ] Live verification prints only success state.
- [ ] Secret scans do not print matches.
- [ ] `.env` is ignored before and after writing and never staged.
- [ ] `CLAUDE.md` and unrelated behavior remain untouched.

## Execution Choice

1. **Subagent-Driven (recommended):** Explicitly authorize task delegation and review each task separately.
2. **Inline Execution:** Execute all three tasks in this session with executing-plans checkpoints.
