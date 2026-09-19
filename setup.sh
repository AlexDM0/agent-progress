#!/usr/bin/env bash
# setup.sh — install the agent-progress tooling on this machine: Bun, `bun install` + `bun link`, and
# a symlink from ~/.claude/skills/agent-progress to this repository's skill/.
#
# It edits nothing outside $HOME/.claude and, on the offer, one shell rc file, and it deletes nothing
# that is not a symlink it wrote. Per-repository setup is `agent-progress init`'s job, not this one's.
#
# Usage: ./setup.sh [--instruct-only]
#   --instruct-only  changes nothing: every offer declines and every write is reported as "would".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTRUCT_ONLY=0
for argument in "$@"; do
  case "$argument" in
    --instruct-only) INSTRUCT_ONLY=1 ;;
    *) printf "Unknown option: %s\nUsage: ./setup.sh [--instruct-only]\n" "$argument" >&2; exit 1 ;;
  esac
done

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m•\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✘\033[0m %s\n" "$1"; }
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# offer "prompt" → 0 to proceed. In --instruct-only mode always declines.
offer() {
  [[ "$INSTRUCT_ONLY" == "1" ]] && return 1
  local answer
  read -r -p "  $1 [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

step "1/3 Bun"
export PATH="$HOME/.bun/bin:$PATH"
if command -v bun >/dev/null 2>&1; then
  BUN_VERSION="$(bun --version)"
  ok "bun $BUN_VERSION found ($(command -v bun))"
  if [[ "$(printf '%s\n' "1.2.0" "$BUN_VERSION" | sort -V | head -1)" != "1.2.0" ]]; then
    warn "bun ≥ 1.2 is recommended (you have $BUN_VERSION) — consider: bun upgrade"
  fi
else
  fail "bun not found"
  if offer "Install Bun now via the official installer (curl -fsSL https://bun.sh/install | bash)?"; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    command -v bun >/dev/null 2>&1 || { fail "bun still not found after install — open a new terminal and re-run ./setup.sh"; exit 1; }
    ok "bun $(bun --version) installed"
  else
    fail "Bun is required. Install it from https://bun.sh and re-run ./setup.sh"
    exit 1
  fi
fi

step "2/3 Dependencies and the global agent-progress command (bun install, bun link)"
# Run on every setup, not only the first: a checkout brought up to date may need a dependency the
# previous one did not, and without `marked` every command that rewrites the page fails.
if ( cd "$HERE" && bun install >/dev/null 2>&1 ); then
  ok "dependencies installed (bun install in $HERE)"
else
  fail "bun install failed — run it yourself in $HERE; agent-progress cannot render its page without marked"
fi
if ! ( cd "$HERE" && bun link >/dev/null 2>&1 ); then
  warn "bun link failed — you can still run: bun \"$HERE/agent-progress.ts\" <command>"
fi
if command -v agent-progress >/dev/null 2>&1; then
  ok "agent-progress is on your PATH ($(command -v agent-progress))"
else
  warn "agent-progress linked, but ~/.bun/bin is not on your PATH in this shell"
  SHELL_RC="$HOME/.zshrc"; [[ "${SHELL:-}" == */bash ]] && SHELL_RC="$HOME/.bashrc"
  if ! grep -qs '\.bun/bin' "$SHELL_RC" 2>/dev/null; then
    if offer "Add 'export PATH=\"\$HOME/.bun/bin:\$PATH\"' to $SHELL_RC?"; then
      printf '\nexport PATH="$HOME/.bun/bin:$PATH"\n' >> "$SHELL_RC"
      ok "Added to $SHELL_RC — takes effect in new terminals"
    else
      warn "Then use: bun \"$HERE/agent-progress.ts\" <command>, or add ~/.bun/bin to PATH yourself"
    fi
  else
    ok "$SHELL_RC already exports ~/.bun/bin — open a new terminal to pick it up"
  fi
fi

step "3/3 The agent-progress Claude skill"
# A symlink, never a copy: `cli/HelpText.spec.ts` holds the bundled skill against the command table in
# this checkout, and a copy under ~/.claude would be the one version nothing checks.
#
# The one thing this block removes is a symlink; anything else at that path is reported and left where
# it is, because ~/.claude/skills/ is a directory people keep their own work in.
SKILLS_DIRECTORY="$HOME/.claude/skills"
SKILL_TARGET="$SKILLS_DIRECTORY/agent-progress"
SKILL_SOURCE="$HERE/skill"

# Both sides of "is it already linked?" resolve physically: a textual readlink comparison is wrong the
# moment either path crosses a symlinked component (/tmp against /private/tmp), and the script would
# then relink on every run.
resolved_directory() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null || true
  else
    ( cd -P "$1" >/dev/null 2>&1 && pwd -P ) || true
  fi
}

if [[ ! -f "$SKILL_SOURCE/SKILL.md" ]]; then
  warn "No skill bundled at $SKILL_SOURCE — skipping"
elif [[ -L "$SKILL_TARGET" ]]; then
  LINKED_AT="$(resolved_directory "$SKILL_TARGET")"
  SOURCE_AT="$(resolved_directory "$SKILL_SOURCE")"
  if [[ -n "$LINKED_AT" && "$LINKED_AT" == "$SOURCE_AT" ]]; then
    ok "Skill already linked: $SKILL_TARGET → $SKILL_SOURCE"
  elif [[ "$INSTRUCT_ONLY" == "1" ]]; then
    warn "Would relink $SKILL_TARGET → $SKILL_SOURCE (it currently points at ${LINKED_AT:-nothing})"
  else
    rm -f "$SKILL_TARGET"
    mkdir -p "$SKILLS_DIRECTORY"
    ln -s "$SKILL_SOURCE" "$SKILL_TARGET"
    ok "Skill relinked: $SKILL_TARGET → $SKILL_SOURCE"
  fi
elif [[ -e "$SKILL_TARGET" ]]; then
  if [[ -d "$SKILL_TARGET" ]]; then
    warn "$SKILL_TARGET is a real directory, not a symlink — left untouched."
  else
    warn "$SKILL_TARGET is a real file, not a symlink — left untouched."
  fi
  warn "  Move or delete it yourself, then re-run ./setup.sh to install the link."
elif [[ "$INSTRUCT_ONLY" == "1" ]]; then
  warn "Would link $SKILL_TARGET → $SKILL_SOURCE"
else
  mkdir -p "$SKILLS_DIRECTORY"
  ln -s "$SKILL_SOURCE" "$SKILL_TARGET"
  ok "Skill linked: $SKILL_TARGET → $SKILL_SOURCE"
fi

# The claude-skills repository adopts any skill under ~/.claude/skills/ that its "ignore" list does not
# name, replacing the link above with a stale copy. Reported and never fixed here: that file is another
# repository's tracked source, and editing it would leave an uncommitted change in somebody's tree.
CLAUDE_REPOSITORY_SKILLS_JSON="$HOME/development/claude/skills.json"
if [[ -f "$CLAUDE_REPOSITORY_SKILLS_JSON" ]] && ! grep -q '"agent-progress"' "$CLAUDE_REPOSITORY_SKILLS_JSON"; then
  warn "$CLAUDE_REPOSITORY_SKILLS_JSON does not list \"agent-progress\" under \"ignore\"."
  warn "  That repository's install.sh would adopt this skill and clobber the symlink above."
  warn "  Add \"agent-progress\" to the \"ignore\" array there, then commit it."
fi

printf "\n\033[1mTooling ready.\033[0m Next:  cd <a repository> && agent-progress init\n"
