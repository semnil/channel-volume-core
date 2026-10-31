#!/usr/bin/env bash
# Brings an extension's shared files to channel-volume-core's main through a
# pull request, where main has moved past the commit the extension's core.json
# locks. Run by the extension's .github/workflows/sync-core.yaml from a clone
# of channel-volume-core, in the extension's checkout of its default branch,
# with GH_TOKEN a token whose pushes and pull requests start the extension's
# workflows, and SYNC_GIT_NAME / SYNC_GIT_EMAIL the author of the commit it
# makes.
#   bash <clone of channel-volume-core>/sync-core.sh <clone of channel-volume-core>
# The pull request comes from one branch, sync/channel-volume-core, which each
# run writes anew from the default branch. A branch whose last commit someone
# else made or committed is left as it is, and the run fails naming them; so
# does a branch that moves while the run is under way, and a run that cannot
# read the branch. Where the repository allows auto-merge, the pull request
# merges once its checks pass. Where core.json already locks main, a pull
# request still open from the branch has nothing left to take: it is closed
# and the branch deleted, unless someone else made or committed the branch's
# last commit, in which case it is left open. A fork's pull request from a
# branch of the same name is not the run's: it is neither updated nor closed.
set -euo pipefail

core="${1:?usage: bash sync-core.sh <clone of channel-volume-core>}"
branch='sync/channel-volume-core'

# What the branch holds now: its commit in remote and who made and committed
# that commit in made, both empty where there is no branch. A branch that
# cannot be read stops the run.
read_branch() {
  local listed=0 listing
  listing="$(git ls-remote --exit-code --heads origin "refs/heads/${branch}")" || listed=$?
  case "${listed}" in
    0)
      remote="${listing%%[[:space:]]*}"
      git fetch -q origin "${remote}"
      made="$(git log -1 --format='%ae %ce' "${remote}")"
      ;;
    2) remote=''; made='' ;;
    *)
      echo "origin's ${branch} could not be read (git ls-remote exit ${listed})" >&2
      exit 1
      ;;
  esac
}

# The number of the open pull request from the branch into the default
# branch, empty where there is none. Pull requests from forks are not counted.
open_pr() {
  gh pr list --head "${branch}" --base "${default}" --state open \
    --json number,isCrossRepository --jq '.[] | select(.isCrossRepository | not) | .number'
}

default="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${current}" != "${default}" ]]; then
  echo "run from ${current}, not the default branch ${default}" >&2
  exit 1
fi

head="$(git -C "${core}" rev-parse HEAD)"
locked="$(node -p "require('./core.json').core.commit")"
if [[ "${head}" == "${locked}" ]]; then
  echo "core.json already locks ${head}"
  open="$(open_pr)"
  if [[ -n "${open}" ]]; then
    read_branch
    if [[ -n "${remote}" && "${made}" != "${SYNC_GIT_EMAIL} ${SYNC_GIT_EMAIL}" ]]; then
      echo "the pull request from ${branch} ends in a commit by ${made% *}, committed by ${made#* }; it is left open"
      exit 0
    fi
    gh pr close "${branch}" --comment "core.json on ${default} already locks ${head}, channel-volume-core's main, so this pull request has nothing left to take."
    if [[ -n "${remote}" ]]; then
      git push -q --force-with-lease="refs/heads/${branch}:${remote}" origin ":refs/heads/${branch}"
    fi
    echo "closed the pull request from ${branch}"
  fi
  exit 0
fi

# Whether the repository allows auto-merge, read before anything is pushed: a
# setting that cannot be read stops the run.
auto_merge="$(gh api 'repos/{owner}/{repo}' --jq .allow_auto_merge)"
if [[ "${auto_merge}" != 'true' && "${auto_merge}" != 'false' ]]; then
  echo "the repository's auto-merge setting could not be read (got '${auto_merge}')" >&2
  exit 1
fi

read_branch
if [[ -n "${remote}" && "${made}" != "${SYNC_GIT_EMAIL} ${SYNC_GIT_EMAIL}" ]]; then
  echo "${branch} ends in a commit by ${made% *}, committed by ${made#* }; it is left as it is" >&2
  exit 1
fi

git switch -q -C "${branch}"
node "${core}/sync.mjs" "${core}" .
git add -A
git -c user.name="${SYNC_GIT_NAME}" -c user.email="${SYNC_GIT_EMAIL}" \
  commit -q -m "chore: take the shared files from channel-volume-core ${head:0:7}"
git push -q --force-with-lease="refs/heads/${branch}:${remote}" origin "HEAD:refs/heads/${branch}"

body="channel-volume-core's main has moved from ${locked} to ${head}: https://github.com/semnil/channel-volume-core/compare/${locked}...${head}

This pull request copies the shared files as ${head} holds them and locks that commit in core.json."
open="$(open_pr)"
if [[ -n "${open}" ]]; then
  gh pr edit "${branch}" --body "${body}"
else
  gh pr create --base "${default}" --head "${branch}" --title 'chore: take the shared files from channel-volume-core' --body "${body}"
fi
if [[ "${auto_merge}" == 'true' ]]; then
  gh pr merge "${branch}" --auto --merge
fi
