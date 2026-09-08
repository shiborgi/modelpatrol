# CodePatrol, OpenCode and Pi

Add this optional section to the existing **CodePatrol** config:

```json
{
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "model": "auto",
    "apiKeyEnv": "MODELPATROL_API_KEY",
    "harness": "opencode",
    "api": "chat",
    "project": "my-project"
  }
}
```

Keep your explicit trusted `executor` and `verification` commands. This section
does not replace them. It injects `MODELPATROL_BASE_URL`, `MODELPATROL_MODEL`,
`MODELPATROL_API`, `MODELPATROL_API_KEY_ENV`, and `MODELPATROL_HEADERS` into the
stage executor process. Credentials remain in the inherited environment.
The executor must launch the selected harness with that environment and load
the adapter below. No secrets enter executor stdin or authoritative run state.

CodePatrol's executor protocol still requires a real stage result with status,
summary, artifacts and review decisions. Launching `opencode` or `pi` directly
as the executor does not satisfy this JSON protocol. Keep a trusted wrapper
that translates the request into harness execution and validates its result.
ModelPatrol supplies transport extensions, not a replacement workflow executor.

## OpenCode

The adapter targets OpenCode 1.x `config` and `chat.headers` hooks (the local
installation at implementation time was 1.18.29). Install the ModelPatrol package
or reference its absolute file URL in the harness configuration:

```json
{"plugin":["file:///absolute/path/modelpatrol/integrations/opencode.mjs"]}
```

Load this trusted config in each executor's OpenCode process. The plugin creates
the `modelpatrol` provider, sets the main/small model, and sends stage metadata
on gateway calls. Existing explicit agent-level model overrides may bypass the
provider; configure those agents to use `modelpatrol/auto` as well. OpenCode 2.x
has different provider configuration and is not claimed compatible here.

`api: "responses"` uses `@ai-sdk/openai`, `messages` uses `@ai-sdk/anthropic`,
and `chat` uses `@ai-sdk/openai-compatible`. Configured packages are resolved by
OpenCode, not vendored by ModelPatrol. Select the protocol appropriate to the
candidate models; Codex Responses models cannot participate in a Chat-only pool.

## Pi

Set `harness: "pi"` in CodePatrol. Launch Pi with the extension and model:

```sh
pi --extension /absolute/path/modelpatrol/integrations/pi.mjs \
  --provider modelpatrol --model auto
```

The adapter uses the documented `registerProvider` extension API. It creates a
text model with conservative 32K context/4K output settings; adjust those
declarations to your configured routing pool when adding vision/reasoning.
Numeric cost fields required by Pi are placeholders; ModelPatrol SQLite is
the accounting source. The Pi package is not installed or bundled here; adapter
tests exercise its registration contract with a fixture, not a live Pi process.

## Process isolation and trust

Start a fresh harness process per CodePatrol stage. Do not reuse a shared
OpenCode server or Pi session across concurrent runs: its environment would
retain the previous stage's metadata. Harness plugins are executable trusted
code. Pin their version/path with the executor. Metadata never grants review,
verification or release authority; all existing CodePatrol gates remain active.
