#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$project_dir/.runtime/bun/bun" "$project_dir/macos/secure_tunnel.mjs" stop
