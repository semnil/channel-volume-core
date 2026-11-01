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

- `shared/core/common.js:290` a guard is dropped ×1 — if (!Object.prototype.hasOwnProperty.call(entry, 'gain')) return entry;

## shared/core/loudness.js

Measured with a copy of the file instrumented at each site and run under
`test/loudness.test.cjs`, every case passing but the one that holds the file
to a single top-level name, which the instrumentation itself breaks.

Exits no caller reaches. `balanceTree` is called only by `insertTreeValue`
and `removeTreeValue`, each with a node it has just read a key from;
`blocksToLufs` only by `addBlock`, after its push; and the relative gate is a
tenth of the mean of what passed the absolute gate, which the largest of those
windows is at or above, so the index it walks is never left empty. The
instrumented copy threw at each of the three, and none threw.

- `shared/core/loudness.js:159` a guard is dropped ×1 — if (!node) return null;
- `shared/core/loudness.js:230` a guard is dropped ×1 — if (list.length === 0) return -Infinity;
- `shared/core/loudness.js:301` a guard is dropped ×1 — if (gated.count === 0) return { lufs: -Infinity, windows: 0 };

The empty index's exit. Without it the mean is `0 / 0`, the relative gate
`NaN`, and the walk of an empty index answers a count of 0, which takes the
next exit with the same answer. The instrumented copy took the unguarded path
beside the guarded one each of the 129 times the exit was reached and found a
count of 0 every time.

- `shared/core/loudness.js:297` a guard is dropped ×1 — if (absoluteGatedCount === 0) return { lufs: -Infinity, windows: 0 };

`removeTreeValue`'s shortcut for a node with no left child. Without it the
node takes its successor's key and count and the successor leaves the right
subtree, which holds the same levels as the right subtree the shortcut
answers. The instrumented copy ran that path on a copy of the node wherever
the shortcut was taken with a right child, and the levels and counts were the
same every time.

- `shared/core/loudness.js:201` a guard is dropped ×1 — if (!node.left) return node.right;

The block trim. Momentary, Short-term and the gating window read the last 30
blocks at most, so what the trim drops is never read, and with a short list
the splice count is negative and removes nothing. The instrumented copy kept
every block beside the trimmed list and read the three from both on every
block (the list was trimmed 146572 times): they were the same numbers.

- `shared/core/loudness.js:320` a guard body is dropped ×1 — if (blocks.length > Math.max(MOMENTARY_BLOCKS, SHORT_BLOCKS) * 4) {
- `shared/core/loudness.js:320` a guard is always taken ×1 — if (blocks.length > Math.max(MOMENTARY_BLOCKS, SHORT_BLOCKS) * 4) {

The removal of a window under the absolute gate from the index. Such a window
was never put there, and every level the index holds is above it, so the walk
goes left to an empty node and the tree comes back as it was. The instrumented
copy removed it from a copy of the index and compared the two, node by node,
at the one such removal the tests make: they were the same.

- `shared/core/loudness.js:360` a guard is always taken ×1 — if (ms >= ABSOLUTE_GATE_MEAN_SQUARE) {

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
