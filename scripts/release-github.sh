#!/usr/bin/env bash
# Publish the plugin to the PUBLIC GitHub marketplace repo — the repo behind
# `/plugin marketplace add mrieck/socialcue-claude-plugin`.
#
# Bitbucket stays the private dev remote. What lands on GitHub is a single
# squashed snapshot commit of the current tree (git commit-tree), so private
# development history is never published — each release replaces main.
#
# Prereqs (once): have the GitHub repo `mrieck/socialcue-claude-plugin`,
# and have push access via SSH. Override the remote with SOCIALCUE_GITHUB_REMOTE.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${SOCIALCUE_GITHUB_REMOTE:-git@github.com:mrieck/socialcue-claude-plugin.git}"
VERSION=$(node -p "require('./.claude-plugin/plugin.json').version")

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree not clean — commit first (the snapshot mirrors HEAD)." >&2
  exit 1
fi

# The dashboard ships prebuilt (plugin installs copy the repo; no post-install
# build step). Refuse to publish if dist would change.
(cd dashboard && npm run build >/dev/null)
if [[ -n "$(git status --porcelain dashboard/dist)" ]]; then
  echo "error: dashboard/dist is stale — commit the rebuilt dist first." >&2
  git status --short dashboard/dist >&2
  exit 1
fi

SNAP=$(git commit-tree 'HEAD^{tree}' -m "Social Cue plugin v${VERSION}")
git push --force "$REMOTE" "${SNAP}:refs/heads/main"
git tag -f "public-v${VERSION}" "$SNAP" >/dev/null
git push --force "$REMOTE" "refs/tags/public-v${VERSION}"

echo "published v${VERSION} -> ${REMOTE} (snapshot ${SNAP:0:10})"
echo "users install with: /plugin marketplace add mrieck/claude-plugins (or mrieck/socialcue-claude-plugin directly)"
