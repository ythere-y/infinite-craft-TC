# OpenAI-Compatible LLM Adapter Design

## Goal

Replace the retired custom GLM HTTP integration with one OpenAI-compatible adapter that can run against EdgeOne Makers or an external provider by changing environment variables only. Configure EdgeOne Makers locally without committing its credential.

## Scope

This change covers only the server-side LLM transport and its configuration. It does not change game prompts, combination rules, caches, first-discovery semantics, UI behavior, or the Redis/SQLite architecture.

## Selected Approach

Use the official `openai` Python client behind the existing `backend.llm.query(payload, temperature)` interface.

The alternatives were rejected for these reasons:

- Replacing only the old URL would still send the obsolete `{question: ...}` wire format and could not parse a chat-completions response.
- Maintaining separate Makers and external-provider implementations would duplicate request, timeout, retry, error, and parsing logic.

One OpenAI-compatible implementation keeps the game code provider-neutral and makes switching environments a configuration operation.

## Configuration Contract

The adapter reads these server-side variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `LLM_API_KEY` | One key variable is required | Generic credential, preferred when present |
| `MAKERS_MODELS_KEY` | One key variable is required | Makers-compatible credential fallback |
| `LLM_BASE_URL` | Yes | OpenAI-compatible API root |
| `LLM_MODEL` | Yes | Provider model identifier |
| `LLM_TIMEOUT` | No | Request timeout in seconds, default `15` |
| `LLM_MAX_RETRIES` | No | SDK retry count, default `2` |

Credential precedence is `LLM_API_KEY` first, then `MAKERS_MODELS_KEY`. This lets an external development environment use the generic name while the Makers environment can use its documented key name.

The checked-in `.env.example` contains variable names and non-secret examples only. The real local credential is stored in `.env`, which is already covered by `.gitignore`. Docker Compose explicitly forwards these variables to the web container. The application loads a local `.env` for non-Compose development, while deployment platforms may inject the same variables directly.

No endpoint returns the key, and logs never include key values, authorization headers, complete exception payloads, or the full provider URL.

## Request and Response Flow

`backend.prompt.combine_via_llm` continues to call:

```python
query({"question": prompt}, temperature=0.85)
```

The adapter converts this internal request to one chat-completions call:

```python
client.chat.completions.create(
    model=settings.model,
    messages=[{"role": "user", "content": payload["question"]}],
    temperature=temperature,
)
```

It converts the first assistant message back to the existing internal shape:

```python
{"text": completion.choices[0].message.content}
```

This preserves the existing tolerant JSON extraction in `backend.prompt.parse_response` and avoids provider-specific code outside `backend/llm.py`.

The client is created lazily so importing the application does not fail merely because LLM variables are absent. Settings are validated before the first request. Missing or incomplete configuration returns `None`, allowing the existing game fallback to operate.

## Error Handling

- The OpenAI client owns timeout and transient retry behavior.
- Missing key, base URL, or model produces a concise `not configured` message without values.
- Provider errors, timeouts, malformed responses, or empty choices return `None`.
- Logs include only a safe error class or status category; they do not include response bodies that may echo prompts or credentials.
- A failed LLM call does not prevent seed/cache combinations from working.

## Health Reporting

The current health endpoint labels the provider as `glm` and spends a model request on every health check. It will be changed to a generic `llm` field reporting `configured` or `not_configured` without making a billable provider call.

Connectivity is verified separately during deployment with one explicit low-token smoke request. This prevents uptime probes from consuming tokens and avoids coupling service health to a third-party model response.

## Local and Deployment Configuration

The ignored local `.env` will be configured for EdgeOne Makers with:

- `MAKERS_MODELS_KEY` set to the user-supplied local credential;
- `LLM_BASE_URL` set to the Makers OpenAI-compatible gateway;
- `LLM_MODEL` set to the selected Makers model;
- safe timeout and retry values.

To switch to an external OpenAI-compatible provider, set `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` for that environment. No source-code changes are required.

## Test Strategy

Unit tests use a fake OpenAI client and never access the network or a real key. They cover:

- generic-key and Makers-key precedence;
- incomplete configuration returning `None`;
- correct model, message, and temperature mapping;
- assistant content converted to `{"text": ...}`;
- empty/malformed completions and provider exceptions returning `None`;
- logs and health output containing no credential value;
- existing prompt parsing remaining compatible.

Deployment verification covers:

- `.env` is ignored and absent from `git ls-files`;
- tracked files contain no key-shaped credential;
- Docker Compose forwards only named environment variables;
- one live request succeeds with the configured Makers model;
- the game `/api/combine` path still falls back safely if the provider is unavailable.

## Files Changed

- `backend/llm.py`: OpenAI-compatible client and settings validation.
- `backend/main.py`: generic, non-billable LLM health status.
- `requirements.txt`: add the OpenAI client and local dotenv loader.
- `docker-compose.yml`: forward generic LLM/Makers variables.
- `.env.example`: document non-secret configuration.
- `.env`: local Makers configuration; ignored and never staged.
- `tests/test_llm.py`: adapter unit tests.
- `README.md`: provider switching and secret-handling instructions.

## Acceptance Criteria

- EdgeOne Makers can generate a completion through the game adapter using the ignored local configuration.
- Switching to another OpenAI-compatible provider requires environment-variable changes only.
- Seed/cache behavior remains available with missing or failed LLM configuration.
- Health checks do not call the model.
- No real credential is present in tracked files, commits, logs, API output, or test fixtures.
