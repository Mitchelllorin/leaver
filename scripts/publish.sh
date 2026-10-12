#!/usr/bin/env bash
#
# Publish this project to your own Git remote — in one command.
#
#   ./scripts/publish.sh https://github.com/you/orrery.git
#
# It does the fiddly parts for you:
#   1. takes your name and email once, and re-authors every commit as yours
#      (the history was written by an agent, so it says so)
#   2. puts your name in the LICENSE
#   3. points `origin` at your repository
#   4. pushes this branch as `main`
#
# Before running it, create the repository EMPTY on your host — no README, no
# .gitignore, no licence. A repository that already has commits would need a
# force push, which this script deliberately will not do.
#
# Running it twice is harmless: it is idempotent apart from the push.
set -euo pipefail

die() { printf '\n  error: %s\n\n' "$1" >&2; exit 1; }
note() { printf '  %s\n' "$1"; }

REMOTE="${1:-}"
[ -n "$REMOTE" ] || die "give me your repository URL, e.g.
         ./scripts/publish.sh git@github.com:you/orrery.git"

cd "$(git rev-parse --show-toplevel)"
git rev-parse --git-dir >/dev/null 2>&1 || die "this is not a git repository"

# --- 1. whose work is this? --------------------------------------------------
NAME="$(git config --get user.name || true)"
EMAIL="$(git config --get user.email || true)"
if [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
  printf '\n  This history was authored by an agent, so let us put your name on it.\n\n'
  [ -n "$NAME" ]  || read -r -p "  Your name:  " NAME
  [ -n "$EMAIL" ] || read -r -p "  Your email: " EMAIL
  [ -n "$NAME" ] && [ -n "$EMAIL" ] || die "a name and an email are required to author commits"
fi
git config user.name "$NAME"
git config user.email "$EMAIL"
note "commits will be authored as $NAME <$EMAIL>"

if git log --format='%an' | grep -q 'Freebuff Agent'; then
  note "re-authoring existing commits…"
  git rebase --root --exec 'git commit --amend --no-edit --reset-author' >/dev/null 2>&1 \
    || die "could not re-author the commits; make sure the working tree is clean"
fi

# --- 2. put your name on the licence -----------------------------------------
if [ -f LICENSE ] && grep -q 'Orrery contributors' LICENSE; then
  # Portable in-place edit: BSD sed on macOS needs the empty argument, GNU does not.
  sed -i.bak "s/Copyright (c) 2026 Orrery contributors/Copyright (c) $(date +%Y) $NAME/" LICENSE && rm -f LICENSE.bak
  git add LICENSE
  git diff --cached --quiet || git commit -q -m "docs: put $NAME on the licence"
  note "LICENSE now credits $NAME"
fi

# --- 3. point at your repository ---------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
  note "origin updated to $REMOTE"
else
  git remote add origin "$REMOTE"
  note "origin added: $REMOTE"
fi

# --- 4. push -----------------------------------------------------------------
printf '\n'
note "pushing. If your host asks for a password, use a personal access token"
note "rather than your account password — GitHub and GitLab both require this."
printf '\n'
git push -u origin HEAD:main

printf '\n  Done. Your repository is live.\n'
printf '  On your device:  git clone %s && cd orrery && npm ci && npm run dev\n\n' "$REMOTE"
