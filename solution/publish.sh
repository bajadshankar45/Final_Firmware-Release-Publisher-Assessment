#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT_ROOT="$ROOT"
if [ -d "$ROOT/environment/fixtures" ]; then
	PROJECT_ROOT="$ROOT/environment"
fi
export PUBLISHER_PROJECT_ROOT="$PROJECT_ROOT"
exec node "$ROOT/solution/reference/release-publisher.mjs" --report
