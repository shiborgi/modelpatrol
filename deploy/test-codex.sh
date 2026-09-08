#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ ! -f deploy/local.env ]; then
  echo "Create deploy/local.env from deploy/local.env.example" >&2
  exit 1
fi

set -a
. deploy/local.env
set +a

node bin/modelpatrol.js serve --config deploy/modelpatrol.local.json &
gateway_pid=$!
response_file=$(mktemp "${TMPDIR:-/tmp}/modelpatrol-codex-response.XXXXXX")
cleanup() {
  rm -f "$response_file"
  kill "$gateway_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:4318/health >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "ModelPatrol did not become ready on 127.0.0.1:4318" >&2
  exit 1
fi

status=$(curl --silent --show-error --output "$response_file" --write-out '%{http_code}' http://127.0.0.1:4318/v1/responses \
  -H "Authorization: Bearer $MODELPATROL_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-patrol-step: smoke-test" \
  -H "x-patrol-agent: codepatrol" \
  -d '{"model":"codex/coder","input":"Responda somente: OK"}')
cat "$response_file"
echo
if [ "$status" != "200" ]; then
  echo "Codex smoke test failed with HTTP $status" >&2
  exit 1
fi
