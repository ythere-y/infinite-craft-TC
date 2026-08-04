# LLM Runtime Isolation Design

## Problem

Infinity Craft has two intentionally separate model transports:

- Local FastAPI development calls the privately configured DeepSeek API.
- Makers production Edge Functions call Makers Models through the Makers
  gateway.

The current configuration helpers accept credentials and model settings from
the other runtime. That fallback makes a deployment appear configured while
silently selecting the wrong provider.

## Design

`backend.llm.LLMSettings.from_env()` will read only local `LLM_*` variables.
It will require `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`; it will not
accept `MAKERS_MODELS_KEY`.

`edge-functions/_lib/llm.js` will read only Makers variables. The API key will
come from `MAKERS_MODELS_KEY`; optional base URL, model, and timeout overrides
will come from `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_MODEL`, and
`AI_GATEWAY_TIMEOUT`. Defaults remain
`https://ai-gateway.edgeone.link/v1` and
`@makers/deepseek-v4-flash`, and 15 seconds. It will not accept
`AI_GATEWAY_API_KEY` or any `LLM_*` variable.

No request payload, timeout, prompt, parsing, KV, or frontend behavior changes
are included.

## Error Handling

Existing degradation remains unchanged. A runtime with only the other
runtime's credentials is reported as `not_configured`, and dynamic
combinations use the established fallback result instead of contacting a
provider.

## Verification

Tests will prove both negative boundaries:

- Makers configuration remains unconfigured when only local `LLM_*` values
  are present.
- Local configuration remains unconfigured when only
  `MAKERS_MODELS_KEY` is present.

Existing positive-path tests will continue proving that each runtime uses its
own provider settings.
