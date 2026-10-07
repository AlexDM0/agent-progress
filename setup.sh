#!/usr/bin/env bash
# setup.sh — install the agent-progress tooling on this machine: Bun, `bun install` + `bun link`, the
# removal of the ~/.claude/skills/ symlinks earlier versions made, and this repository's
# `core.hooksPath` pointed at its tracked `.githooks/`.
#
# It edits nothing outside $HOME/.claude, this repository's git config and, on the offer, one shell rc
# file, and it deletes nothing that is not a symlink into this checkout. Per-repository setup, the
# skills included, is `agent-progress init`'s job, not this one's.
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

step "1/4 Bun"
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

step "2/4 Dependencies and the global agent-progress command (bun install, bun link)"
# Run on every setup, not only the first: a checkout brought up to date may need a dependency the
# previous one did not, and without `marked` every command that rewrites the page fails.
# Skipped under --instruct-only: `bun link` repoints the machine-wide command at this checkout, and a
# dry run from a worktree would leave it pointing at a directory a release later removes.
if [[ "$INSTRUCT_ONLY" == "1" ]]; then
  warn "Would run bun install in $HERE"
  warn "Would run bun link in $HERE"
else
  if ( cd "$HERE" && bun install >/dev/null 2>&1 ); then
    ok "dependencies installed (bun install in $HERE)"
  else
    fail "bun install failed — run it yourself in $HERE; agent-progress cannot render its page without marked"
  fi
  if ! ( cd "$HERE" && bun link >/dev/null 2>&1 ); then
    warn "bun link failed — you can still run: bun \"$HERE/agent-progress.ts\" <command>"
  fi
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

step "3/4 Retire the global agent-progress Claude skills"
# `agent-progress init` and `update` copy both skills into each tracked repository's .claude/skills/, so
# nothing is linked into ~/.claude/skills/ any more. This removes the two links earlier versions made,
# and only when each is a symlink resolving into this checkout: ~/.claude/skills/ is a directory people
# keep their own work in, so anything else at those paths is reported and left where it is.
SKILLS_DIRECTORY="$HOME/.claude/skills"
RETIRED_SKILL_NAMES=(agent-progress agent-progress-orchestrate)

# Both sides resolve physically: a textual readlink comparison is wrong the moment either path crosses a
# symlinked component (/tmp against /private/tmp).
resolved_directory() {
  if command -v realpath >/dev/null 2>&1; then
    realpath "$1" 2>/dev/null || true
  else
    ( cd -P "$1" >/dev/null 2>&1 && pwd -P ) || true
  fi
}

CHECKOUT_AT="$(resolved_directory "$HERE")"

remove_retired_skill_link() {
  local skill_target="$1"
  if [[ -L "$skill_target" ]]; then
    local linked_at
    linked_at="$(resolved_directory "$skill_target")"
    if [[ -n "$linked_at" && "$linked_at" == "$CHECKOUT_AT/"* ]]; then
      if [[ "$INSTRUCT_ONLY" == "1" ]]; then
        warn "Would remove the retired skill link $skill_target → $linked_at"
      else
        rm -f "$skill_target"
        ok "Removed the retired skill link $skill_target → $linked_at"
      fi
    else
      warn "$skill_target is a symlink to ${linked_at:-nothing}, not into this checkout — left untouched."
    fi
  elif [[ -e "$skill_target" ]]; then
    warn "$skill_target is not a symlink setup.sh made — left untouched. agent-progress init installs the skill per repository now; remove it yourself if it is a stale copy."
  else
    ok "No global skill at $skill_target"
  fi
}

for RETIRED_SKILL_NAME in "${RETIRED_SKILL_NAMES[@]}"; do
  remove_retired_skill_link "$SKILLS_DIRECTORY/$RETIRED_SKILL_NAME"
done

step "4/4 The pre-commit hook (git config core.hooksPath)"
# The relative path resolves in whichever worktree a commit is made, and the setting is shared by every
# worktree of this repository, so dispatched agents' commits pass the same gate.
GIT_HOOKS_PATH=".githooks"
CURRENT_HOOKS_PATH="$(git -C "$HERE" config --get core.hooksPath || true)"
if [[ "$CURRENT_HOOKS_PATH" == "$GIT_HOOKS_PATH" ]]; then
  ok "core.hooksPath already points at $GIT_HOOKS_PATH"
elif [[ "$INSTRUCT_ONLY" == "1" ]]; then
  warn "Would set core.hooksPath to $GIT_HOOKS_PATH in $HERE (it is currently ${CURRENT_HOOKS_PATH:-unset})"
else
  git -C "$HERE" config core.hooksPath "$GIT_HOOKS_PATH"
  ok "core.hooksPath set to $GIT_HOOKS_PATH (it was ${CURRENT_HOOKS_PATH:-unset})"
fi

printf "\n\033[1mTooling ready.\033[0m Next:  cd <a repository> && agent-progress init\n"
