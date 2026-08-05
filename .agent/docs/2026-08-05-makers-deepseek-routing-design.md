# Makers DeepSeek Routing Design

## Goal

Allow the production Makers Edge Function to switch explicitly between the
current Makers Models built-in model and the project's own official DeepSeek
V4 Flash account. Both routes must disable thinking and bound model output.
Local FastAPI configuration remains isolated and unchanged.

## Runtime configuration

The Makers console provides two new variables:

```dotenv
MAKERS_USE_OWN_DEEPSEEK=1
MAKERS_DEEPSEEK_API_KEY=<official DeepSeek API key>
```

`MAKERS_USE_OWN_DEEPSEEK` accepts `1`, `true`, `yes`, or `on`
case-insensitively. Any other value selects the existing Makers Models route.

When the own-DeepSeek route is selected:

- API key: `MAKERS_DEEPSEEK_API_KEY`
- base URL: `https://api.deepseek.com`
- model: `deepseek-v4-flash`
- provider reported by health: `deepseek-direct`

When it is not selected:

- API key: `MAKERS_MODELS_KEY`
- base URL: `AI_GATEWAY_BASE_URL`, defaulting to the current Makers gateway
- model: `AI_GATEWAY_MODEL`, defaulting to
  `@makers/deepseek-v4-flash`
- provider reported by health: `edgeone-makers-models`

The direct route deliberately does not accept local `LLM_*` variables. Its
base URL and model are fixed so the route needs exactly the two new production
variables requested by the operator.

## Request behavior

Both routes use the existing OpenAI-compatible `/chat/completions` transport
and add:

```json
{
  "thinking": { "type": "disabled" },
  "max_tokens": 128
}
```

The prompt, temperature, response parsing, timeout, caching, and rate limiting
remain unchanged.

If the own-DeepSeek route is enabled but
`MAKERS_DEEPSEEK_API_KEY` is absent or blank, model configuration is
unavailable. The request degrades through the established fallback path
instead of silently using the Makers key and consuming its free quota.

## Observability and secret handling

`/api/health` reports the selected provider, base URL, model, and configured
state. It never returns either API key. Existing documentation will list the
two new Makers console variables and explain route selection.

No key is written to `.env.example`, source files, generated output, logs, or
tests. The untracked local `.env` remains outside the production
configuration contract.

## Tests

Automated tests will verify:

1. default Makers routing remains backward compatible;
2. truthy route values select the fixed official DeepSeek endpoint and model;
3. a selected direct route without its key fails closed;
4. local `LLM_*` variables remain ignored by the Makers runtime;
5. outbound requests on both routes disable thinking and set
   `max_tokens` to 128;
6. health reports the selected provider without exposing credentials.

The developer documentation will be reviewed alongside the implementation;
human-facing prose is not protected by a source-text assertion.
