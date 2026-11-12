# channel-volume-core

The files the channel-volume extensions share. Each extension carries a copy of the groups its `core.json` names, and its CI fails where a copy differs from the commit of this repository the extension locks.

## Layout

| Path | Role |
|------|------|
| `shared/` | The shared files, each at the path it has inside an extension. `shared/core/` holds the code the extensions run (classic scripts: `common.js` loaded ahead of each extension's own `utils.js`, `loudness.js` ahead of the script that measures, in whichever world that runs) |
| `groups.json` | Sorts every file under `shared/` into exactly one group (`base`, `measure`, `release`, `auto-merge`, `public`); `test/sync.test.mjs` holds the two lists to each other |
| `sync.mjs` | `node sync.mjs <core> <extension>` writes the files of the extension's groups as `<core>`'s `HEAD` commit holds them (executable bit included) and locks that commit in the extension's `core.json`. `--check <core> <extension>` compares the extension with the commit it locks and exits 1 naming each file that differs, is missing or changed its executable bit. Both read from the commit, never from `<core>`'s working tree |
| `shared/tools/check-shared.sh` | Run by each extension's CI test job: fetches the locked commit from `https://github.com/semnil/channel-volume-core` (or `CORE_SOURCE`) and runs that commit's `sync.mjs --check` |
| `shared/.github/workflows/sync-core.yaml`, `sync-core.sh` | The workflow runs in each extension once a day and by hand, clones this repository and runs its `sync-core.sh` in the extension's default branch: where this repository's `main` has moved past the commit the extension locks, it opens or updates the pull request from `sync/channel-volume-core` that takes it, with a GitHub App's token; where the extension already locks `main`, it closes that pull request if one is still open and the App made its last commit (README.md, "Changing a shared file"). The script is not shared: the run that writes the extension's files does not run from them |
| `test/` | The tests of every shared file and of `sync.mjs` (node:test) |
| `docs/shared-files.md`, `docs/shared-files.ja.md` | What each shared file does in an extension, by part, each part under an `<a id>` the extensions' documents link to. The extensions' documents keep what an extension gives these files and how it uses them, and link here for the rest |
| `coverage-copies.mjs` | Run by CI ahead of the coverage report: in the V8 coverage the tests leave, a script run from a test's copy of a file under `shared/tools/mutation/` (`tools/mutation/<name>` in a `cv-…` box under the system's temporary directory) is given that shared file's URL, so `v8-to-lcov.mjs`, which counts a `file:` URL only where it names the source's own path, counts the run for it |
| `shared/tools/mutation/equivalents.md` | This repository's record of the mutants its tests let through, with what was measured about each. `sweep.mjs` reads it from beside itself, so it sits under `shared/`, but no group carries it: each extension keeps its own record at that path, for its own sources |
| `.github/CODEOWNERS` | This repository's copy of `shared/.github/CODEOWNERS`, so each pull request here, Dependabot's included, asks the owner for a review. `test/codeowners.test.cjs` holds it to the shared file. A change to the shared file comes with the same change to the copy |
| `.github/dependabot.yml` | Dependabot for this repository's workflows and for `shared/.github/workflows`; the extensions run none |
| `.github/workflows/dependabot-auto-merge.yml` | This repository's copy of `shared/.github/workflows/dependabot-auto-merge.yml`, which auto-merges a patch or minor update Dependabot alone wrote here. `test/dependabot-auto-merge.test.cjs` holds it to the shared file but for the commits and versions its `uses:` lines name, and runs `shared/.github/tests/dependabot-auto-merge-test.sh` against it. A change to the shared file comes with the same change to the copy |

An extension's `core.json`:

- `core.groups`: the groups it takes
- `core.commit`: written by `sync.mjs`
- `package`: the name `pack.py` gives the zip before the version (lowercase letters, digits and hyphens)
- `icon`: `background` and `accent` as `[r, g, b]` and `letter` as one character, for `gen_icons.py`

## Commands

```sh
# Run the tests
node --test test/*.test.cjs test/*.test.mjs

# The coverage report CI uploads to Codecov, made locally (<dir> is any empty directory)
NODE_V8_COVERAGE=<dir> node --test test/*.test.cjs test/*.test.mjs
node coverage-copies.mjs <dir>
node shared/tools/coverage/v8-to-lcov.mjs <dir> coverage.lcov sync.mjs $(git ls-files 'shared/*.mjs' 'shared/*.js')

# Sweep one shared file for mutants the tests let through (writes into the tree
# it is given, so give it a worktree rather than the checkout being worked in).
# The tests run through bail.mjs, which stops what a run started when the run is
# stopped: sweep.mjs stops only the command it started, and a test that starts a
# process leaves it running past a timeout otherwise. When the file swept is
# sweep.mjs or bail.mjs, run both from a clone of this repository rather than
# from the tree being swept. MUTATE_TIMEOUT_MS=<n> gives each run n ms instead
# of 180 s; the sweep's own tests use it to reach a hung run in seconds.
# A sweep ended with kill -9 puts nothing back: restore the source in that tree
# with git checkout -- <file> and remove .mutation-sweep-running from its root.
# Do not edit a tree's tests while a sweep of that tree runs: the runs after
# the edit hold the mutants to another suite than the ones before it
node shared/tools/mutation/sweep.mjs <worktree> shared/tools/coverage/v8-to-lcov.mjs \
  node shared/tools/mutation/bail.mjs '^(✖|not ok) ' node --test test/coverage.test.cjs
node <clone>/shared/tools/mutation/sweep.mjs <worktree> shared/tools/mutation/bail.mjs \
  node <clone>/shared/tools/mutation/bail.mjs '^(✖|not ok) ' node --test test/bail.test.cjs

# Ask whether the record still names sites the code has (no test is run)
node shared/tools/mutation/sweep.mjs --verify .

# Copy the shared files into an extension and lock this repository's HEAD
node sync.mjs . <extension>

# Compare an extension's copies with the commit it locks
node sync.mjs --check . <extension>

# Python syntax check of the shared scripts (leaves no __pycache__ behind)
python3 -B -c "import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path('shared').glob('*.py')]"
```

## Conventions

- **Override of the global CLAUDE.md's 「ドキュメント」 language rule**: `README.md` is English and `README.ja.md` is its Japanese counterpart; `CLAUDE.md` is English only
- A change to a file under `shared/` comes with its tests under `test/`, and with `docs/shared-files.md` and `docs/shared-files.ja.md` where it changes what a part does, in the same pull request. It reaches the extensions only through `sync.mjs` after it is merged here: each extension's Sync Core workflow runs it daily and opens the pull request (README.md, "Changing a shared file"), or it is run by hand
- A change that moves a declaration out of an extension into `shared/core/` reaches that extension as one pull request holding both the copy of the shared file and the removal of the extension's own declaration. The scripts of one context share their top-level `const` and `let`, so the copy alone declares the name twice and the script that declares it again fails to load; the daily sync's pull request stops at the extension's CI until the removal is in it
- A change to which scripts share a scope, to the order they are injected in, or to what the manifest makes one script depend on is loaded into a real Chrome (CDP `Extensions.loadUnpacked`) and seen to raise no exception before it merges, here and in an extension alike. The Node suites alone do not pass such a change
- The shared code is tested and swept here alone. The extensions' coverage report, made by the shared `ci.yaml`, leaves out `core/` and `audio-worklet.js`, and their suites hold their own scripts, run with `core/common.js` and `core/loudness.js` loaded as they ship; so `test/common.test.cjs` has to kill every mutant of `shared/core/common.js`, and `test/loudness.test.cjs` every mutant of `shared/core/loudness.js` and `shared/audio-worklet.js`, by itself, bar those `equivalents.md` names
- **Override of the global rule 「ポーリングで interactive 要素の値を書き換えない」**: in an extension's popup and settings page, what decides whether a poll may write a control's value is whether the viewer can operate the control at that moment, not what kind of control it is. A control that is disabled is kept up to date by the poll; one the viewer can operate is not written by it. One element is written by one path: where two paths can reach it, one of them owns it and the other leaves it alone. The reason is in `docs/decisions/ui.md`, "Polling may write a control the viewer cannot operate"
- This repository is public: its text names only the public extensions
- Commit messages follow Conventional Commits
