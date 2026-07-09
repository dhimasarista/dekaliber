#!/usr/bin/env bash
# Source this to load key=value pairs from the repo-root .env (gitignored)
# into the current shell. Unix/macOS counterpart of scripts/load-root-env.ps1.
#
# Usage: source _infra/scripts/load-root-env.sh
set -euo pipefail

_infra_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_root_env_path="$_infra_script_dir/../../.env"

if [ ! -f "$_root_env_path" ]; then
  echo "warning: .env not found at $_root_env_path -- copy .env.example to .env and fill in real values first." >&2
  return 1 2>/dev/null || exit 1
fi

set -a
# shellcheck disable=SC1090
source "$_root_env_path"
set +a

unset _infra_script_dir _root_env_path
