#!/usr/bin/env bash
# Validate all templates and check catalog.json is current.
#
#   scripts/validate.sh                      # uses `orch8` on PATH
#   ORCH8_BIN="docker run --rm -v $PWD:/w -w /w --entrypoint orch8 ghcr.io/orch8-io/engine:latest" scripts/validate.sh
#   SKIP_ENGINE=1 scripts/validate.sh        # static checks only
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/validate.mjs
node scripts/build-catalog.mjs --check
