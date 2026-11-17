#!/usr/bin/env bash
#MISE description="Package and deploy the application with Terraform"
#MISE raw_args=true
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR/app" install --prod --frozen-lockfile --node-linker=hoisted

if find "$ROOT_DIR/app/node_modules" -type l -print -quit | grep -q .; then
  echo "Deployment dependencies must not contain symlinks." >&2
  exit 1
fi

terraform -chdir="$ROOT_DIR/terraform" apply "$@"
