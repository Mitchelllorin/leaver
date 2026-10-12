#!/usr/bin/env bash
#
# Publish this project to your own GitHub - in one command.
#
#   ./scripts/publish.sh                   # -> github.com/mitchelllorin/orrery
#   ./scripts/publish.sh some-other-name   # a different repository name
#
# You should not have to decide anything to run this. It works out:
#   * who you are, from GitHub itself, with the noreply address GitHub accepts,
#     so the commits link to your account instead of an agent's
#   * whether the repository exists, and creates it (private) if it does not
#   * origin, the branch name, and the licence credit
#
# The one thing it cannot invent is access, so it asks for a token - reads it
# without echoing it, uses it for this push only, and never writes it to disk,
# to .git/config, or into the process list. If you already have an SSH key set up
# it uses that instead and asks for nothing at all.
#
# Safe to run twice, and it will not force-push.
set -euo pipefail

OWNER="${ORRERY_OWNER:-mitchelllorin}"
REPO="${1:-${ORRERY_REPO:-orrery}}"
DRY="${ORRERY_DRY_RUN:-}"

die()   { printf '\n  error: %s\n\n' "$1" >&2; exit 1; }
note()  { printf '  %s\n' "$1"; }
say()   { printf '\n  %s\n' "$1"; }

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || die "run this from inside the repository"
git rev-parse --git-dir >/dev/null 2>&1 || die "this is not a git repository"

# Read one dotted field out of a JSON document on stdin. Empty string if absent.
jget() {
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); raise SystemExit
for key in sys.argv[1].split("."):
    d = d.get(key) if isinstance(d, dict) else None
print("" if d is None else d)
' "$1"
}

api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

# --- is there already a way in? ----------------------------------------------
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
SSH_LOGIN=""
if [ -z "$TOKEN" ]; then
  SSH_OUT="$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 \
               -T git@github.com 2>/dev/null || true)"
  case "$SSH_OUT" in
    *"successfully authenticated"*)
      SSH_LOGIN="$(printf '%s' "$SSH_OUT" | sed -n 's/^Hi \([^!]*\)!.*/\1/p')" ;;
  esac
fi

if [ -z "$TOKEN" ] && [ -z "$SSH_LOGIN" ]; then
  say "One thing I need from you: a GitHub token, so I can create and push the repository."
  note "Make one here - tick the 'repo' box, nothing else needed:"
  note ""
  note "  https://github.com/settings/tokens/new?scopes=repo&description=publish-orrery"
  note ""
  note "It is used for this push only, and is not saved anywhere."
  printf '\n  Paste it (it stays hidden as you type, then press Enter;\n  press Enter on its own to stop and set up SSH instead): '
  read -rs TOKEN || true   # EOF is an answer too: fall through to SSH
  printf '\n'
fi

# --- who are you, and where are we going? ------------------------------------
if [ -n "$TOKEN" ]; then
  command -v python3 >/dev/null || die "python3 is needed to read GitHub's reply"

  ME="$(api https://api.github.com/user)"
  LOGIN="$(printf '%s' "$ME" | jget login)"
  UID_="$(printf '%s' "$ME" | jget id)"
  GH_NAME="$(printf '%s' "$ME" | jget name)"

  if [ -z "$LOGIN" ] || [ -z "$UID_" ]; then
    die "GitHub would not accept that token: $(printf '%s' "$ME" | jget message)"
  fi

  # The token is the authority on who you are - better than me guessing.
  OWNER="$LOGIN"
  NAME="${GH_NAME:-$LOGIN}"
  EMAIL="${UID_}+${LOGIN}@users.noreply.github.com"
  AUTH="token"
else
  OWNER="${SSH_LOGIN:-$OWNER}"
  NAME="$(git config --get user.name || true)"
  EMAIL="$(git config --get user.email || true)"
  if [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
    say "Authenticating over SSH, but I still need a name and email to author the commits."
    [ -n "$NAME" ]  || read -r -p "  Your name:  " NAME
    [ -n "$EMAIL" ] || read -r -p "  Your email: " EMAIL
  fi
  AUTH="ssh"
fi

[ -n "$NAME" ] && [ -n "$EMAIL" ] || die "a name and an email are required to author commits"
SLUG="$OWNER/$REPO"
note "publishing to github.com/$SLUG as $NAME <$EMAIL>"

# --- re-author the history as yours -------------------------------------------
git config user.name "$NAME"
git config user.email "$EMAIL"
if git log --format='%an %ae' | grep -q 'Freebuff Agent'; then
  if [ -n "$(git status --porcelain)" ]; then
    die "you have uncommitted changes. Commit or stash them first: re-authoring every
         commit is a rewrite, and I would rather not do it over a dirty tree."
  fi
  note "re-authoring the history as yours…"
  # --allow-empty because the very first commit of an agent-generated
  # workspace is often an empty placeholder, and amending an empty commit is
  # refused without it - which aborts the whole rewrite on commit one.
  git rebase --root --exec 'git commit --amend --no-edit --reset-author --allow-empty' >/dev/null
fi

# --- put your name on the licence ---------------------------------------------
if [ -f LICENSE ] && grep -q 'Orrery contributors' LICENSE; then
  sed -i.bak "s/Copyright (c) 2026 Orrery contributors/Copyright (c) $(date +%Y) $NAME/" LICENSE && rm -f LICENSE.bak
  git add LICENSE
  git diff --cached --quiet || git commit -q -m "docs: put $NAME on the licence"
  note "LICENSE now credits $NAME"
fi

# --- create the repository if it is not there ---------------------------------
if [ -n "$DRY" ]; then
  say "dry run: I would now check, create and push github.com/$SLUG"
  exit 0
fi

CREATED=0
if [ "$AUTH" = "token" ]; then
  EXISTING="$(api "https://api.github.com/repos/$SLUG")"
  if [ "$(printf '%s' "$EXISTING" | jget message)" = "Not Found" ]; then
    note "no such repository yet - creating it (private, so nothing is public by accident)"
    MADE="$(api -X POST https://api.github.com/user/repos -d "{
      \"name\": \"$REPO\",
      \"private\": true,
      \"has_issues\": true,
      \"has_wiki\": false,
      \"has_projects\": false,
      \"auto_init\": false,
      \"description\": \"A browser solar system you fly in first person, land anywhere on, and watch misbehave at random.\"
    }")"
    if [ "$(printf '%s' "$MADE" | jget message)" != "" ]; then
      die "could not create the repository: $(printf '%s' "$MADE" | jget message)"
    fi
    CREATED=1
    note "created github.com/$SLUG"
  else
    note "github.com/$SLUG already exists - pushing to it"
    if [ "$(printf '%s' "$EXISTING" | jget size)" != "0" ]; then
      note "it already has commits; if the push below is rejected, that is why."
      note "I will not force-push, so nothing of yours can be destroyed."
    fi
  fi

  # The token goes into an askpass helper's environment, not into the URL, not
  # into .git/config, and not into the process list where `ps` could read it.
  TMPD="$(mktemp -d)"
  trap 'rm -rf "$TMPD"; unset GITHUB_TOKEN' EXIT
  cat > "$TMPD/askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *[Uu]sername*) echo x-access-token ;;
  *)             echo "$GITHUB_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$TMPD/askpass"
  export GIT_ASKPASS="$TMPD/askpass" GITHUB_TOKEN="$TOKEN" GIT_TERMINAL_PROMPT=0
  git remote set-url origin "https://github.com/$SLUG.git" 2>/dev/null \
    || git remote add origin "https://github.com/$SLUG.git"
  git -c credential.helper= push -u origin HEAD:main
else
  git remote set-url origin "git@github.com:$SLUG.git" 2>/dev/null \
    || git remote add origin "git@github.com:$SLUG.git"
  git push -u origin HEAD:main
fi

# --- tell you what to do next -------------------------------------------------
say "Live. https://github.com/$SLUG"
note ""
note "On your device:"
note "  git clone https://github.com/$SLUG.git && cd $REPO"
note "  npm ci && npm run dev"
note ""
note "Your whole iteration loop is:   npm run check"
note "  ~5 seconds, no browser needed. It is how the bugs in this one were found."
note ""
if [ "$CREATED" = "1" ]; then
  note "It is private, which is the safer default - nothing is public until you"
  note "decide it should be. To change that: Settings -> General -> Danger Zone."
else
  note "That was a repository you had already made, so I left its own settings"
  note "alone - visibility and description are yours, not mine to change."
fi
note ""
