# Contributing a template

A good template is small and honest about what it needs. Someone new to Orch8
should be able to read it in a couple of minutes and understand what to wire
up before running it.

## Requirements

1. **Directory and name.** Use `templates/<name>/`. `<name>` must be kebab-case
   (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique. It must match `name` in both
   `template.json` and `sequence.json`.
2. **`sequence.json`** is an authoring-format sequence:
   - Include `"$schema"`, `"schema_version": 1`, `"namespace"`, `"name"`, and
     `"blocks"`.
   - Do **not** set `id`, `version`, `created_at`, or `tenant_id`. The CLI and
     the API assign them.
   - Use only block types and fields documented in the engine's
     [`docs/SEQUENCES.md`](https://github.com/orch8-io/engine/blob/main/docs/SEQUENCES.md).
   - Read runtime inputs from `context.data.*` rather than hard-coding URLs or
     account IDs.
3. **`template.json`** contains:
   - `description`: one sentence of at least 20 characters. This is what
     `orch8 templates list` shows.
   - `tags` and `author`.
   - `min_engine_version`: the oldest engine version the template was
     validated on.
   - `handlers.builtin`: every built-in handler you use.
   - `handlers.workers`: every external-worker handler, each with its `queue`
     and a one-line `contract` covering input, success, failure, and
     idempotency.
   - `requires`: context fields, triggers, credentials, and environment
     variables in plain language.
   - `validation.context` and `validation.mocks`: see below.
4. **Handlers.** Prefer built-in handlers (`http_request`, `llm_call`,
   `human_review`, `emit_event`, `embed`, `memory_store`, `log`, `noop`, and
   others). If a step needs custom code, use an external worker handler and
   document its contract. Don't reference plugins or integrations that users
   can't obtain.
5. **No secrets.** No API keys, tokens, passwords, or private URLs. Read keys
   from the environment instead, for example with `api_key_env`. The
   validator rejects common secret patterns.
6. **Safe by default.** Put a `retry` policy on steps with side effects. Give
   loops and `for_each` a sensible `max_iterations`. Set timeouts on human
   gates.

## Validation

`scripts/validate.sh` runs static checks, then runs each template once through
the real engine:

```
orch8 dev templates/<name>/sequence.json --dry-run --skip-timers --once \
  --context '<validation.context>' --mock <handler>=<json> ...
```

Handlers listed in `validation.mocks` return the given JSON instead of
running. Mock anything that makes network calls or needs a worker. Every
external-worker handler must have a mock. A passing run shows that:

- the definition parses and passes engine validation
- its templates resolve
- it reaches the `Completed` state

A passing run does **not** show that your endpoints or workers behave
correctly.

```bash
# with a local CLI
scripts/validate.sh
# with the published container image (the engine version CI uses)
ORCH8_BIN="docker run --rm -v $PWD:/w -w /w --entrypoint orch8 ghcr.io/orch8-io/engine:latest" scripts/validate.sh
# static checks only
SKIP_ENGINE=1 scripts/validate.sh
```

After you add or change a template, regenerate the catalog and commit it:

```bash
node scripts/build-catalog.mjs
```

CI (`.github/workflows/validate.yml`) runs the same checks and fails if
`catalog.json` is stale.

## Review checklist for maintainers

- Is the description accurate? Are `requires` and the worker contracts complete?
- Nothing in the template should send data somewhere the user didn't configure.
- Mocks should be realistic enough that routers take a meaningful branch.
- Does the contributor agree to the repository license? The license is still
  **TODO** (see LICENSE). Don't merge outside contributions until one is chosen.
