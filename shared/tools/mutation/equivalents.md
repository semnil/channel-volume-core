# Mutants this repository's tests let through, and why each one is equivalent

`sweep.mjs` turns each source into mutants and runs the tests against every
one. A mutant the tests still pass is either a gap in the tests or a change the
code cannot be told apart from — this file names the second kind, one entry per
mutant, with what was measured about it. It is this repository's record of the
shared files, and no group carries it: an extension keeps its own at the same
path, for its own sources.

Entries are read back by `node shared/tools/mutation/sweep.mjs --verify .`,
which `test/sweep.test.cjs` runs: an entry naming a site the code no longer has
is a reason nobody can check, which is what a list like this turns into if it
is only prose. The format is `- ``file:line`` label ×N — <the text the rule
matched>`, where N is how many of that group are equivalent, and the paths are
the ones a sweep run from this repository's root reports. Every list item in
this file is read as an entry. What `--verify` cannot see is an entry whose
mutant the tests have come to kill: the site is still there, so only a sweep of
that file finds it, by what it does not find standing.

## shared/core/common.js

`expandLegacyGain`'s check that the entry has a gain of the earlier form.
Without it, an entry with none goes on: `Number.isFinite(undefined)` is false,
so no slot is written, and `delete entry.gain` on a key that is not there is a
no-op — the same entry comes back, unchanged.

- `shared/core/common.js:254` a guard is dropped ×1 — if (!Object.prototype.hasOwnProperty.call(entry, 'gain')) return entry;

## shared/tools/mutation/bail.mjs

The refusal on Windows. On macOS and Linux the platform is never `win32`, so
there a check that is never taken is the check as it stands; on Windows the
tests ask for the refusal itself.

- `shared/tools/mutation/bail.mjs:34` a guard body is dropped ×1 — if (process.platform === 'win32') {

## shared/tools/mutation/sweep.mjs

`releaseMarker`'s refusal of a run that has no marker of its own. Its one
caller is `finish`, and every path to `finish` starts after `guardTree` has
created the marker and taken its inode, which happens before anything else
can fail; `--verify` exits without reaching `finish`. Measured with a copy
that logs each call: across `test/sweep.test.cjs` and
`test/sweep-run.test.cjs`, all passing, the function was called 36 times and
held a claimed marker every time.

- `shared/tools/mutation/sweep.mjs:139` a guard is dropped ×1 — if (!claimed) return false;
- `shared/tools/mutation/sweep.mjs:139` false becomes true ×1 — return false;
