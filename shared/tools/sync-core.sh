#!/usr/bin/env bash
# Brings this extension's shared files to channel-volume-core's main through a
# pull request, where main has moved past the commit core.json locks. Run by
# .github/workflows/sync-core.yaml from the default branch, with GH_TOKEN a
# token whose pushes and pull requests start the extension's workflows, and
# SYNC_GIT_NAME / SYNC_GIT_EMAIL the author of the commit it makes.
#   bash tools/sync-core.sh <clone of channel-volume-core>
# The pull request comes from one branch, sync/channel-volume-core, which each
# run writes anew from the default branch. A branch whose last commit someone
# else made is left as it is, and the run fails naming that author. Where the
# repository allows auto-merge, the pull request merges once its checks pass.
set -euo pipefail

core="${1:?usage: bash tools/sync-core.sh <clone of channel-volume-core>}"
branch='sync/channel-volume-core'

head="$(git -C "${core}" rev-parse HEAD)"
locked="$(node -p "require('./core.json').core.commit")"
if [[ "${head}" == "${locked}" ]]; then
  echo "core.json already locks ${head}"
  exit 0
fi

if git ls-remote --exit-code --heads origin "${branch}" > /dev/null; then
  git fetch -q origin "${branch}"
  author="$(git log -1 --format=%ae FETCH_HEAD)"
  if [[ "${author}" != "${SYNC_GIT_EMAIL}" ]]; then
    echo "${branch} ends in a commit by ${author}; it is left as it is" >&2
    exit 1
  fi
fi

base="$(git rev-parse --abbrev-ref HEAD)"
git switch -q -C "${branch}"
node "${core}/sync.mjs" "${core}" .
git add -A
git -c user.name="${SYNC_GIT_NAME}" -c user.email="${SYNC_GIT_EMAIL}" \
  commit -q -m "chore: take the shared files from channel-volume-core ${head:0:7}"
git push -q --force origin "${branch}"

body="channel-volume-core's main has moved from ${locked} to ${head}: https://github.com/semnil/channel-volume-core/compare/${locked}...${head}

This pull request copies the shared files as ${head} holds them and locks that commit in core.json."
if [[ -n "$(gh pr list --head "${branch}" --state open --json number --jq '.[].number')" ]]; then
  gh pr edit "${branch}" --body "${body}"
else
  gh pr create --base "${base}" --head "${branch}" --title 'chore: take the shared files from channel-volume-core' --body "${body}"
fi
if [[ "$(gh repo view --json autoMergeAllowed --jq .autoMergeAllowed)" == 'true' ]]; then
  gh pr merge "${branch}" --auto --merge
fi
