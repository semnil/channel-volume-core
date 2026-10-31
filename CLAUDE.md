# channel-volume-core

The files the channel-volume extensions share. Each extension carries a copy of the groups its `core.json` names, and its CI fails where a copy differs from the commit of this repository the extension locks.

## Layout

| Path | Role |
|------|------|
| `shared/` | The shared files, each at the path it has inside an extension |
| `groups.json` | Sorts every file under `shared/` into exactly one group (`base`, `release`, `auto-merge`, `public`); `test/sync.test.mjs` holds the two lists to each other |
| `sync.mjs` | `node sync.mjs <core> <extension>` writes the files of the extension's groups as `<core>`'s `HEAD` commit holds them (executable bit included) and locks that commit in the extension's `core.json`. `--check <core> <extension>` compares the extension with the commit it locks and exits 1 naming each file that differs, is missing or changed its executable bit. Both read from the commit, never from `<core>`'s working tree |
| `shared/tools/check-shared.sh` | Run by each extension's CI test job: fetches the locked commit from `https://github.com/semnil/channel-volume-core` (or `CORE_SOURCE`) and runs that commit's `sync.mjs --check` |
| `test/` | The tests of every shared file and of `sync.mjs` (node:test) |
| `shared/tools/mutation/equivalents.md` | This repository's record of the mutants its tests let through, with what was measured about each. `sweep.mjs` reads it from beside itself, so it sits under `shared/`, but no group carries it: each extension keeps its own record at that path, for its own sources |
| `.github/dependabot.yml` | Dependabot for this repository's workflows and for `shared/.github/workflows`; the extensions run none |

An extension's `core.json`:

- `core.groups`: the groups it takes
- `core.commit`: written by `sync.mjs`
- `package`: the name `pack.py` gives the zip before the version (lowercase letters, digits and hyphens)
- `icon`: `background` and `accent` as `[r, g, b]` and `letter` as one character, for `gen_icons.py`

## Commands

```sh
# Run the tests
node --test test/*.test.cjs test/*.test.mjs

# Sweep one shared file for mutants the tests let through (writes into the tree
# it is given, so give it a worktree rather than the checkout being worked in).
# The tests run through bail.mjs, which stops what a run started when the run is
# stopped: sweep.mjs stops only the command it started, and a test that starts a
# process leaves it running past a timeout otherwise. When the file swept is
# sweep.mjs or bail.mjs, run both from a clone of this repository rather than
# from the tree being swept. MUTATE_TIMEOUT_MS=<n> gives each run n ms instead
# of 180 s; the sweep's own tests use it to reach a hung run in seconds
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
- A change to a file under `shared/` comes with its tests under `test/` in the same pull request. It reaches the extensions only through `sync.mjs` after it is merged here
- This repository is public: its text names only the public extensions
- Commit messages follow Conventional Commits
