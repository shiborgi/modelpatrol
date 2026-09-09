# CodePatrol, OpenCode and Pi

Add this optional section to the existing **CodePatrol** config:

```json
{
  "modelpatrol": {
    "baseUrl": "http://127.0.0.1:4318",
    "model": "auto",
    "apiKeyEnv": "MODELPATROL_API_KEY",
    "harness": "pi",
    "api": "chat",
    "project": "my-project"
  }
}
```

Use CodePatrol's packaged `codepatrol-pi-executor` or another explicit trusted
executor, plus an explicit verification command. The ModelPatrol section injects
`MODELPATROL_BASE_URL`, `MODELPATROL_MODEL`,
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
{"plugin":["file:///absolute/path/modelpatrol/integrations/opencode/index.mjs"]}
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

Install the current official Pi package, then set `harness: "pi"` in CodePatrol:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

ModelPatrol exposes the installed extension path without requiring consumers to
know its package layout:

```sh
modelpatrol integration-path pi
```

For an interactive entry point from any configured repository, install the local
CodePatrol checkout once as a global Pi package:

```sh
pi install /absolute/path/to/codepatrol
```

After exporting the same `MODELPATROL_API_KEY` used by the CodePatrol config,
start `pi` at the clean repository root and invoke `/patrol <feature>`. The
interactive command launches the complete gated workflow; stage subprocesses
receive only CodePatrol's structured completion tool, not the `/patrol` command.

For a direct diagnostic launch:

```sh
pi --extension /absolute/path/modelpatrol/integrations/pi/index.mjs \
  --provider modelpatrol --model auto
```

The adapter lives in the harness-specific `integrations/pi/` module and uses the
documented `registerProvider` extension API. It creates a
text model with conservative 32K context/4K output settings; adjust those
declarations to your configured routing pool when adding vision/reasoning.
Numeric cost fields required by Pi are placeholders; ModelPatrol SQLite is
the accounting source. The Pi package is installed separately and is not bundled
with ModelPatrol.

Pi normally consumes an SSE response. A selected local subscription harness is
still non-streaming internally; ModelPatrol waits for its complete Chat response
and emits one valid buffered SSE turn. This compatibility boundary never reports
incremental latency or usage that the underlying harness did not provide.

## Process isolation and trust

Start a fresh harness process per CodePatrol stage. Do not reuse a shared
OpenCode server or Pi session across concurrent runs: its environment would
retain the previous stage's metadata. Harness plugins are executable trusted
code. Pin their version/path with the executor. Metadata never grants review,
verification or release authority; all existing CodePatrol gates remain active.
