// sweep.test.cjs — tools/mutation/sweep.mjs claims its tree before it writes,
// shares a sweep between shards, keeps its marker up over a source it could not
// put back, and checks equivalents.md against the code without running a suite.

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { shared, tempDir } = require('./helpers.cjs');

const SWEEP = shared('tools', 'mutation', 'sweep.mjs');

// Every box a case makes goes when the file's tests end, whichever way a case
// ends.
const made = [];
after(() => { for (const box of made) fs.rmSync(box, { recursive: true, force: true }); });

// A copy of the sweeper and a list written for the occasion, so that what the
// check refuses can be asked without touching the tree this suite runs in.
function equivalentsBox(entries, sources = {}) {
  const box = tempDir('cv-equivalents-');
  made.push(box);
  fs.mkdirSync(path.join(box, 'tools', 'mutation'), { recursive: true });
  fs.copyFileSync(
    SWEEP,
    path.join(box, 'tools/mutation/sweep.mjs')
  );
  fs.writeFileSync(path.join(box, 'tools/mutation/equivalents.md'), entries);
  for (const [name, text] of Object.entries(sources)) {
    fs.writeFileSync(path.join(box, name), text);
  }
  const run = require('node:child_process').spawnSync(
    'node', ['tools/mutation/sweep.mjs', '--verify'], { cwd: box, encoding: 'utf8' }
  );
  fs.rmSync(box, { recursive: true, force: true });
  return run;
}

// The one source the cases below are written against. Line 2 is what every
// entry names.
const BOX_SOURCE = 'function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\n';
const BOX_ENTRY = '- `src.js:2` a guard is dropped ×1 — if (!a) return b;';

// A tree of its own for the sweep to write into, since a sweep writes.
function sweepBox(source) {
  const box = tempDir('cv-sweep-');
  made.push(box);
  fs.mkdirSync(path.join(box, 'tools', 'mutation'), { recursive: true });
  fs.copyFileSync(
    SWEEP,
    path.join(box, 'tools/mutation/sweep.mjs')
  );
  fs.writeFileSync(path.join(box, 'src.js'), source);
  fs.writeFileSync(path.join(box, 'suite.js'), 'require("./src.js"); process.exit(0);\n');
  const git = (...args) => require('node:child_process').execFileSync('git', args, { cwd: box });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'box');
  // A shim loaded before sweep.mjs, so that the filesystem under it can be made
  // to fail: a named call refused the way a full disk or a read-only directory
  // refuses it, and a restore that reports success while putting down something
  // else.
  fs.writeFileSync(path.join(box, 'inject.cjs'), [
    "const fs = require('fs');",
    "for (const [name, code] of [['writeFileSync', 'ENOSPC'], ['unlinkSync', 'EACCES']]) {",
    '  const real = fs[name];',
    '  fs[name] = (...args) => {',
    '    if (process.env.INJECT === name) {',
    '      const err = new Error(`${code} injected`); err.code = code; throw err;',
    '    }',
    '    return real(...args);',
    '  };',
    '}',
    '// The three ways a restore fails. RESTORE_FAILS=<how>:<n> picks one and says',
    '// which of the writes that put the source back it happens on: content puts',
    '// down something else and reports success, write refuses, read lets the write',
    '// through and refuses the read that checks it. The errors carry no code, so',
    '// what is printed is the message they do carry.',
    'const wrote = fs.writeFileSync, read = fs.readFileSync;',
    "const pristine = read('src.js', 'utf8');",
    "const [how, nth] = (process.env.RESTORE_FAILS || '').split(':');",
    'let restores = 0, refuseRead = false;',
    'fs.writeFileSync = (file, data, ...rest) => {',
    "  if (nth && String(file).endsWith('src.js') && data === pristine && ++restores >= Number(nth)) {",
    "    if (how === 'write') throw new Error('the disk went away');",
    "    if (how === 'read') refuseRead = true;",
    "    if (how === 'content') return wrote(file, data + '// not the source', ...rest);",
    '  }',
    '  return wrote(file, data, ...rest);',
    '};',
    'fs.readFileSync = (file, ...rest) => {',
    "  if (refuseRead && String(file).endsWith('src.js')) {",
    '    refuseRead = false;',
    "    throw new Error('the file went away');",
    '  }',
    '  return read(file, ...rest);',
    '};',
    ''
  ].join('\n'));
  // The sweeps these cases run are their own. A sweep running this suite has its
  // knobs in the environment, and a run that inherited them would measure what
  // that sweep asked for rather than what the case asks for.
  const boxEnv = (extra) => {
    const env = { ...process.env, ...extra };
    for (const knob of ['MUTATE_LINES', 'MUTATE_COUNT', 'MUTATE_CONFIRM', 'MUTATE_OPTIONAL', 'MUTATE_SHARD', 'MUTATE_TIMEOUT_MS']) {
      if (!extra || !(knob in extra)) delete env[knob];
    }
    return env;
  };
  const sweep = (...args) => require('node:child_process').spawnSync(
    'node', ['tools/mutation/sweep.mjs', '.', ...args], { cwd: box, encoding: 'utf8', env: boxEnv() }
  );
  const sweepWith = (env, ...args) => require('node:child_process').spawnSync(
    'node', ['--require', './inject.cjs', 'tools/mutation/sweep.mjs', '.', ...args],
    { cwd: box, encoding: 'utf8', env: boxEnv(env) }
  );
  return {
    sweep,
    sweepWith,
    locked: () => fs.existsSync(path.join(box, '.mutation-sweep-running')),
    mark: (text) => fs.writeFileSync(path.join(box, '.mutation-sweep-running'), `${text}\n`),
    source: () => fs.readFileSync(path.join(box, 'src.js'), 'utf8'),
    remove: () => fs.rmSync(box, { recursive: true, force: true })
  };
}

test('a sweep that cannot start leaves the tree it was going to write to alone', () => {
  // The marker is claimed before the source is read, so a source that is not
  // there used to leave the tree locked by a run that was already gone — and
  // every later sweep of that tree stopped on a marker nobody could account
  // for.
  const box = sweepBox('function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\nmodule.exports = { pick };\n');
  try {
    const missing = box.sweep('does-not-exist.js', 'node', 'suite.js');
    assert.equal(missing.status, 2, missing.stderr);
    assert.match(missing.stderr, /does-not-exist\.js could not be read \(ENOENT\)/);
    assert.equal(box.locked(), false, 'the tree is not left locked by a run that never began');

    // And the tree takes a sweep afterwards.
    const after = box.sweep('src.js', 'node', 'suite.js');
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /src\.js is back as it was/);
    assert.equal(box.locked(), false);
  } finally {
    box.remove();
  }
});

test('shards share a sweep between trees, and a shard that cannot be one is refused', () => {
  // Between them the shards run each mutant once, and a shard that cannot be
  // one is refused before anything runs. The box's suite passes every mutant,
  // so what a run lists standing is what it ran, in the order it ran them.
  const box = sweepBox('function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\nmodule.exports = { pick };\n');
  try {
    const standing = (run) => run.stdout.split('\n').filter((line) => line.startsWith('SURVIVED'));
    const whole = box.sweep('src.js', 'node', 'suite.js');
    assert.equal(whole.status, 0, whole.stderr);
    assert.equal(standing(whole).length, 2, `the whole sweep runs both mutants (${standing(whole).join(' | ')})`);
    for (const k of [0, 1]) {
      const half = box.sweepWith({ MUTATE_SHARD: `${k}/2` }, 'src.js', 'node', 'suite.js');
      assert.equal(half.status, 0, half.stderr);
      assert.match(half.stderr, new RegExp(`shard ${k}/2: 1 of 2 mutants`));
      assert.deepEqual(standing(half), [standing(whole)[k]], `shard ${k}/2 runs mutant ${k} of the whole sweep's order`);
    }
    for (const wrong of ['2/2', '-1/2']) {
      const refused = box.sweepWith({ MUTATE_SHARD: wrong }, 'src.js', 'node', 'suite.js');
      assert.equal(refused.status, 2, refused.stderr);
      assert.ok(refused.stderr.includes(`MUTATE_SHARD wants <k>/<n> with 0 <= k < n, got ${wrong}`), refused.stderr);
      assert.equal(refused.stdout, '', `a shard of ${wrong} runs nothing`);
      assert.equal(box.locked(), false, `a shard of ${wrong} leaves the tree unmarked`);
    }
  } finally {
    box.remove();
  }
});

test('a sweep that cannot put its marker down says so, and does not exit 0', () => {
  // The two ends of the marker's life, made to fail the way a full disk and a
  // read-only directory make them fail. What the run is holding is the file it
  // created, which is why a marker it could not write into is still its own to
  // take away.
  const box = sweepBox('function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\nmodule.exports = { pick };\n');
  try {
    const unwritable = box.sweepWith({ INJECT: 'writeFileSync' }, 'src.js', 'node', 'suite.js');
    assert.equal(unwritable.status, 2, unwritable.stderr);
    assert.match(unwritable.stderr, /\.mutation-sweep-running could not be written \(ENOSPC\)/);
    assert.equal(box.locked(), false, 'a marker it could not write into is still taken away');

    // And the tree is not left locked against the next run.
    const after = box.sweep('src.js', 'node', 'suite.js');
    assert.equal(after.status, 0, after.stderr);

    const unremovable = box.sweepWith(
      { INJECT: 'unlinkSync', MUTATE_COUNT: '1' }, 'src.js', 'node', 'suite.js'
    );
    assert.equal(unremovable.status, 5, `a marker left behind is not exit 0 (${unremovable.stderr})`);
    assert.match(unremovable.stderr, /could not take its marker off .*\(EACCES\)/);
    assert.equal(box.locked(), true, 'and it says so about a marker that is really there');
  } finally {
    box.remove();
  }
});

test('a source the sweep could not put back keeps the marker up', () => {
  // The sweep's last write is let through with a line of its own added, so what
  // it reads back is not what it wrote. What decides whether the marker comes
  // off is the source having been read again and matched, not the write having
  // reported success: a tree that holds a mutant keeps the marker that says so.
  // The runs after the first have every mutant filtered out, so the write
  // before the last one is a restore as well: what a restore leaves is not what
  // the one before it left. The last three are the three ways a restore fails.
  const source = 'function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\nmodule.exports = { pick };\n';
  for (const { fails, knobs, says, holds } of [
    { fails: 'content:2', knobs: {}, holds: `${source}// not the source` },
    { fails: 'content:2', knobs: { MUTATE_LINES: '900-901' }, holds: `${source}// not the source` },
    { fails: 'write:2', knobs: {}, says: /src\.js could not be written back \(the disk went away\)/ },
    { fails: 'read:2', knobs: {}, says: /src\.js could not be read back \(the file went away\)/ }
  ]) {
    const box = sweepBox(source);
    try {
      const spoiled = box.sweepWith({ RESTORE_FAILS: fails, ...knobs }, 'src.js', 'node', 'suite.js');
      assert.equal(spoiled.status, 4, `a source that may not be back is not exit 0 (${fails}: ${spoiled.stderr})`);
      assert.match(spoiled.stderr, /src\.js is not what it was before the sweep; the tree holds a mutant, and .*\.mutation-sweep-running stays/);
      assert.doesNotMatch(spoiled.stdout, /is back as it was/, `${fails}: a run that could not put the source back does not say it did`);
      assert.equal(box.locked(), true, `${fails}: the marker stays up over it`);
      if (says) assert.match(spoiled.stderr, says);
      if (holds) assert.equal(box.source(), holds, `${fails}: the source on disk is the one it could not put back`);
    } finally {
      box.remove();
    }
  }
});

test('a tree already being swept is refused, and one nobody holds is named', () => {
  const box = sweepBox('function pick(a, b) {\n  if (!a) return b;\n  return a;\n}\nmodule.exports = { pick };\n');
  try {
    // A marker a live process holds: the claim is refused and the holder named.
    box.mark(`src.js is being mutated by tools/mutation/sweep.mjs (pid ${process.pid})`);
    const busy = box.sweep('src.js', 'node', 'suite.js');
    assert.equal(busy.status, 2, busy.stderr);
    assert.match(busy.stderr, new RegExp(`already being swept by pid ${process.pid}`));
    assert.equal(box.locked(), true, "the holder's marker is left where it is");

    // A marker from a run that is gone says so, and says the tree may hold what
    // that run left, rather than taking it over.
    box.mark('src.js is being mutated by tools/mutation/sweep.mjs (pid 999999)');
    const stale = box.sweep('src.js', 'node', 'suite.js');
    assert.equal(stale.status, 2, stale.stderr);
    assert.match(stale.stderr, /carries a marker from pid 999999 that is gone/);
  } finally {
    box.remove();
  }
});

test('the record check passes a list that still names the code', () => {
  const run = equivalentsBox(`# t\n\n${BOX_ENTRY}\n`, { 'src.js': BOX_SOURCE });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1 entries covering 1 mutants/);
});

test('the record check refuses a list that has moved away from the code', () => {
  // The ways a list stops describing the code. Each is what the check is for,
  // and each has to be refused rather than counted.
  const asked = [
    ['more of a site than the code has', `# t\n\n- \`src.js:2\` a guard is dropped ×9 — if (!a) return b;\n`, 1],
    ['a line that moved', `# t\n\n- \`src.js:3\` a guard is dropped ×1 — if (!a) return b;\n`, 1],
    ['another guard taking that line', `# t\n\n- \`src.js:2\` a guard is dropped ×1 — if (!b) return a;\n`, 1],
    ['a source that is gone', `# t\n\n- \`gone.js:2\` a guard is dropped ×1 — if (!a) return b;\n`, 1],
    // Beside an entry that reads, so that the refusal comes from the unreadable
    // one rather than from the list having nothing in it at all.
    ['an entry it cannot read', `# t\n\n${BOX_ENTRY}\n- \`src.js:2\` a guard is dropped x1\n`, 2],
    ['a count of none', `# t\n\n- \`src.js:99\` a guard is dropped ×0 — if (!nothing) return here;\n`, 2],
    ['a bullet written with another mark', `# t\n\n${BOX_ENTRY}\n* \`src.js:99\` a guard is dropped ×1 — if (!nothing) return here;\n`, 2],
    ['an entry indented into the prose', `# t\n\n${BOX_ENTRY}\n  - \`src.js:99\` a guard is dropped ×1 — if (!nothing) return here;\n`, 2],
    ['an entry that lost a backtick', `# t\n\n${BOX_ENTRY}\n- src.js:99\` a guard is dropped ×1 — if (!nothing) return here;\n`, 2],
    ['an entry written as a numbered list', `# t\n\n${BOX_ENTRY}\n1. \`src.js:99\` a guard is dropped ×1 — if (!nothing) return here;\n`, 2],
    ['a list naming no mutants', '# t\n\nnothing here\n', 2]
  ];
  for (const [what, entries, status] of asked) {
    const run = equivalentsBox(entries, { 'src.js': BOX_SOURCE });
    assert.equal(run.status, status, `${what}: ${run.stdout}${run.stderr}`);
    assert.equal(run.stdout, '', `${what} is refused rather than counted`);
  }
});

// The record of the mutants this repository's tests let through names sites
// the shared files still have.
test('the mutants the tests let through are still the ones named', () => {
  const checked = require('node:child_process').spawnSync('node', [SWEEP, '--verify', path.join(__dirname, '..')],
    { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /every one of them still a site the code has/);
});
