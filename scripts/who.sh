#!/usr/bin/env bash
# Who wrote what, and on which branch. Reads the trailers .githooks stamps.
#
#   scripts/who.sh                 # last 25, everyone
#   scripts/who.sh carrie          # just mine
#   scripts/who.sh -b claude/lanes # just that branch
#   scripts/who.sh -n 60 nigel
set -uo pipefail
N=25; WHO=""; BR=""
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N="$2"; shift 2 ;;
    -b) BR="$2"; shift 2 ;;
    *)  WHO="$1"; shift ;;
  esac
done
ARGS=(-n "$N" --format='%C(auto,yellow)%h%C(reset) %C(auto,cyan)%<(16,trunc)%an%C(reset) %<(28,trunc)%(trailers:key=Branch,valueonly,separator=%x2C)%C(reset) %s')
# --author matches the git identity; --grep matches the Branch trailer. Two
# different mechanisms because they answer two different questions, and the
# branch one survives the branch being deleted.
[ -n "$WHO" ] && ARGS+=(--author="$WHO" --regexp-ignore-case)
[ -n "$BR" ]  && ARGS+=(--grep="^Branch: $BR$" --extended-regexp)
git log "${ARGS[@]}"
