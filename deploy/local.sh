#!/bin/sh
set -eu

if [ ! -f deploy/local.env ]; then
  echo "Create deploy/local.env from deploy/local.env.example" >&2
  exit 1
fi

set -a
. deploy/local.env
set +a

# The gateway owns one centralized harness-adapter boundary. Do not start a
# separate provider process or port from this launcher.
exec node bin/modelpatrol.js serve --config deploy/modelpatrol.local.json
