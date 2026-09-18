#!/bin/sh
# Prefer installed toolchains; this fallback is only for the initial build host.
if ! command -v cargo >/dev/null 2>&1 && [ -x /tmp/local-postman-cargo/bin/cargo ]; then
  export CARGO_HOME=/tmp/local-postman-cargo
  export RUSTUP_HOME=/tmp/local-postman-rustup
  export PATH="/tmp/local-postman-cargo/bin:$PATH"
fi
exec "$@"
