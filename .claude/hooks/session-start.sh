#!/bin/bash
# SessionStart hook for Claude Code on the web — installs what `pnpm typecheck` / `pnpm test` /
# `pnpm build` need in a fresh cloud container. Local sessions skip it (Peter's checkouts already
# have node_modules and the shared-checkout rules in CLAUDE.md apply there, not here).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# pnpm is pinned by package.json#packageManager; corepack honours it when the image's pnpm differs.
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
fi

# The lockfile is the contract — a resolution change belongs in a commit, not a session.
# NB `bignumber.js` is overridden to the registry copy (package.json#pnpm.overrides): the cloud
# egress policy 403s codeload.github.com tarballs, so the GitHub-hosted fork could never install here.
pnpm install --frozen-lockfile

# `tsc -b` reads the generated route types; `pnpm typecheck` regenerates them itself, but a bare
# `tsc`/editor pass in the session should not trip over a missing .react-router/ on first run.
pnpm exec react-router typegen

# Headed browsers for in-session testing (2026-09-15, verified: Chromium/Firefox/WebKit all render the
# app under `xvfb-run -a`). The image ships only Chromium; Firefox + WebKit download fine through the
# proxy but need system libs, and Chromium trusts the proxy CA only via its NSS store. All best-effort:
# a failure here must not cost the session its install. The container state is cached after this hook,
# so the ~1 min cold cost is paid once.
(env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD pnpm exec playwright install firefox webkit \
  && pnpm exec playwright install-deps firefox webkit) >/tmp/pw-install.log 2>&1 || true
if ! command -v certutil >/dev/null 2>&1; then
  (apt-get update -qq && apt-get install -y -qq libnss3-tools) >/tmp/certutil-install.log 2>&1 || true
fi
if command -v certutil >/dev/null 2>&1 && [ -f /root/.ccr/agent-proxy-ca.crt ]; then
  mkdir -p "$HOME/.pki/nssdb"
  certutil -d "sql:$HOME/.pki/nssdb" -L >/dev/null 2>&1 || certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password
  certutil -d "sql:$HOME/.pki/nssdb" -L -n ccr-agent-proxy >/dev/null 2>&1 \
    || certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt || true
fi

# Dev server, always up for in-session browser testing (Peter, 2026-09-15). The container's ports are
# unreachable from outside, so this exists for the headed Xvfb browsers in the session, not for him.
# Detached + logged; `strictPort` means a second start just fails quietly rather than forking a port.
if ! curl -sf -o /dev/null http://127.0.0.1:5173/; then
  nohup pnpm dev >/tmp/inkwave-dev.log 2>&1 </dev/null &
  disown
fi
