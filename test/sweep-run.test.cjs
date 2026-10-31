// sweep-run.test.cjs — tools/mutation/sweep.mjs from its command line to its
// summary: which mutants each rule makes, what the knobs keep, when it refuses
// to give a verdict, what a confirming command does to the survivors, and how
// a run that takes too long is reported.

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

const SWEEP = shared('tools', 'mutation', 'sweep.mjs');
const KNOBS = ['MUTATE_LINES', 'MUTATE_COUNT', 'MUTATE_CONFIRM', 'MUTATE_OPTIONAL', 'MUTATE_SHARD', 'MUTATE_TIMEOUT_MS'];
// A sweep that never ends fails the case rather than holding the suite.
const TIMEOUT = 20000;

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// One site of every rule, and an optional call for the rule asked for by name.
const RULE_SOURCE = [
  'async function all(a, b, list) {',
  '  if (!a) return b;',
  '  if (a === b) {',
  '    return true;',
  '  }',
  '  if (a !== b && b || a) {',
  '    return false;',
  '  }',
  '  const kept = list.filter(Boolean);',
  '  const last = kept[kept.length - 1];',
  '  await last;',
  '  return list.some(Boolean) || list.every(Boolean) || a?.b;',
  '}',
  'module.exports = { all };',
  ''
].join('\n');

const RULE_MUTANTS = [
  'src.js:2    a guard is dropped — if (!a) return b;',
  'src.js:3    a guard body is dropped — if (a === b) {',
  'src.js:6    a guard body is dropped — if (a !== b && b || a) {',
  'src.js:3    a guard is always taken — if (a === b) {',
  'src.js:6    a guard is always taken — if (a !== b && b || a) {',
  'src.js:6    && becomes || — &&',
  'src.js:6    || becomes && — ||',
  'src.js:12   || becomes && — ||',
  'src.js:12   || becomes && — ||',
  'src.js:3    === becomes !== — ===',
  'src.js:6    !== becomes === — !==',
  'src.js:2    a negation is dropped — (!a)',
  'src.js:4    true becomes false — return true;',
  'src.js:7    false becomes true — return false;',
  'src.js:12   some becomes every — .some(',
  'src.js:12   every becomes some — .every(',
  'src.js:9    filter is dropped — .filter(Boolean)',
  'src.js:10   the first is taken for the last — [kept.length - 1]',
  'src.js:11   an await is dropped — await'
];

// Suites, by what they do with the source.
const READS = 'require("./src.js");\n';
// Fails a source that is not the committed one: every mutant is killed.
const KILLS_ALL = 'const fs = require("fs");\nrequire("./src.js");\n'
  + 'process.exit(fs.readFileSync("src.js", "utf8") === fs.readFileSync("pristine.txt", "utf8") ? 0 : 1);\n';
// Fails, or waits 4 s and then passes, where a guard body was dropped.
const WAITS = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);';
const onDroppedBody = (then) => 'const fs = require("fs");\nrequire("./src.js");\n'
  + `if (fs.readFileSync("src.js", "utf8").includes("if (false) {")) { ${then} }\n`;

// A git tree holding a copy of the sweeper, the source and whatever else the
// case runs, all committed, since the sweep refuses a source that is not.
function box(files = {}) {
  const dir = tempDir('cv-sweep-run-');
  made.push(dir);
  const all = { 'src.js': RULE_SOURCE, 'pristine.txt': RULE_SOURCE, 'suite.js': READS, ...files };
  fs.mkdirSync(path.join(dir, 'tools', 'mutation'), { recursive: true });
  fs.copyFileSync(SWEEP, path.join(dir, 'tools/mutation/sweep.mjs'));
  for (const [name, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, name), text);
  const git = (...args) => execFileSync('git', args, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'box');
  // Only the knobs a case names reach its sweep: a sweep running this suite has
  // its own in the environment.
  const envWith = (knobs) => {
    const env = { ...process.env, ...knobs };
    for (const knob of KNOBS) if (!(knob in knobs)) delete env[knob];
    return env;
  };
  return {
    dir,
    raw: (knobs, ...args) => spawnSync('node', ['tools/mutation/sweep.mjs', ...args],
      { cwd: dir, encoding: 'utf8', env: envWith(knobs), timeout: TIMEOUT }),
    sweep: (knobs = {}, ...command) => spawnSync('node',
      ['tools/mutation/sweep.mjs', '.', 'src.js', ...(command.length ? command : ['node', 'suite.js'])],
      { cwd: dir, encoding: 'utf8', env: envWith(knobs), timeout: TIMEOUT }),
    has: (name) => fs.existsSync(path.join(dir, name)),
    read: (name) => fs.readFileSync(path.join(dir, name), 'utf8'),
    locked: () => fs.existsSync(path.join(dir, '.mutation-sweep-running'))
  };
}

const listed = (run, verdict) => run.stdout.split('\n')
  .filter((line) => line.startsWith(verdict)).map((line) => line.slice(10));
const summary = (run) => (run.stdout.match(/^src\.js: .*$/m) || [''])[0];

// A run that ends without measuring anything leaves the source as it was and
// the tree unmarked.
function untouched(b, why) {
  assert.equal(b.read('src.js'), RULE_SOURCE, `${why}: the source is as it was`);
  assert.equal(b.locked(), false, `${why}: the tree is not left marked`);
}

test('each rule makes the mutant it names, and the optional rule only where asked for', () => {
  const b = box();
  const run = b.sweep();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(listed(run, 'SURVIVED'), RULE_MUTANTS);
  assert.equal(summary(run), 'src.js: 19 mutants, 0 did not parse, 19 run, 0 killed, 19 standing (0 of them hung)');
  assert.match(run.stdout, /src\.js is back as it was/);
  untouched(b, 'a whole sweep');

  const optional = b.sweep({ MUTATE_OPTIONAL: '1' });
  assert.equal(optional.status, 0, optional.stderr);
  assert.deepEqual(listed(optional, 'SURVIVED'),
    [...RULE_MUTANTS, 'src.js:12   an optional call is made unconditional — ?.']);
  for (const value of ['0', 'yes']) {
    const other = b.sweep({ MUTATE_OPTIONAL: value });
    assert.deepEqual(listed(other, 'SURVIVED'), RULE_MUTANTS, `MUTATE_OPTIONAL=${value} adds no rule`);
  }
});

test('a command line that names no tree, source or command is refused', () => {
  const b = box();
  for (const args of [[], ['.'], ['.', 'src.js']]) {
    const run = b.raw({}, ...args);
    assert.equal(run.status, 2, `${JSON.stringify(args)}: ${run.stderr}`);
    assert.match(run.stderr, /^usage: node tools\/mutation\/sweep\.mjs <tree> <source file> <test command…>/);
    untouched(b, JSON.stringify(args));
  }
});

test('a timeout that is not a whole number of milliseconds is refused', () => {
  const b = box();
  for (const value of ['0', '-5', '1.5', 'soon']) {
    const run = b.sweep({ MUTATE_TIMEOUT_MS: value });
    assert.equal(run.status, 2, `${value}: ${run.stderr}`);
    assert.ok(run.stderr.includes(`MUTATE_TIMEOUT_MS wants a whole number of milliseconds, got ${value}`), run.stderr);
    assert.equal(run.stdout, '');
    untouched(b, value);
  }
});

test('a source with uncommitted changes is refused before anything is written', () => {
  const b = box();
  const edited = `${RULE_SOURCE}// an edit not committed\n`;
  fs.writeFileSync(path.join(b.dir, 'src.js'), edited);
  const run = b.sweep();
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /src\.js has uncommitted changes; commit or set them aside before sweeping/);
  assert.equal(b.read('src.js'), edited, 'the edit is left as it was');
  assert.equal(b.locked(), false);
});

test('MUTATE_LINES keeps the mutants inside the lines, and refuses a range that is not one', () => {
  const b = box();
  const region = b.sweep({ MUTATE_LINES: '2-3' });
  assert.equal(region.status, 0, region.stderr);
  assert.match(region.stderr, /lines 2-3: 5 of 19 mutants/);
  assert.deepEqual(listed(region, 'SURVIVED'),
    RULE_MUTANTS.filter((line) => /^src\.js:[23] /.test(line)));
  const one = b.sweep({ MUTATE_LINES: '12-12' });
  assert.deepEqual(listed(one, 'SURVIVED'), RULE_MUTANTS.filter((line) => line.startsWith('src.js:12 ')));
  for (const wrong of ['x-3', '3-x', '5-2', '3']) {
    const run = b.sweep({ MUTATE_LINES: wrong });
    assert.equal(run.status, 2, `${wrong}: ${run.stderr}`);
    assert.ok(run.stderr.includes(`MUTATE_LINES wants <first>-<last>, got ${wrong}`), run.stderr);
    assert.equal(run.stdout, '', `${wrong} runs nothing`);
    untouched(b, wrong);
  }
});

test('MUTATE_COUNT sizes a run and runs nothing', () => {
  const b = box({ 'suite.js': 'require("fs").writeFileSync("ran.txt", "");\nrequire("./src.js");\n' });
  const run = b.sweep({ MUTATE_COUNT: '1' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'src.js: 19 mutants\n');
  assert.equal(b.has('ran.txt'), false, 'no suite was run');
  untouched(b, 'a count');
  const lines = b.sweep({ MUTATE_COUNT: '1', MUTATE_LINES: '6-6' });
  assert.equal(lines.stdout, 'src.js: 5 mutants\n', 'the count is of what the knobs keep');
});

test('a suite with no power over the source, or not green before it, gives no verdict', () => {
  for (const [suite, says] of [
    ['process.exit(0);\n', /the suite passes with src\.js replaced by a throw — it does not read this file/],
    [`${READS}process.exit(1);\n`, /the suite is not green before any mutation is applied \(exit 1\)/]
  ]) {
    const b = box({ 'suite.js': suite });
    const run = b.sweep();
    assert.equal(run.status, 3, run.stderr);
    assert.match(run.stderr, says);
    assert.equal(run.stdout, '', 'and lists nothing');
    untouched(b, suite.trim());
  }
});

test('a suite that cannot be started, or that a signal takes, gives no verdict', () => {
  const b = box({ 'suite.js': 'process.kill(process.pid, "SIGKILL");\n' });
  const missing = b.sweep({}, 'cv-no-such-command');
  assert.equal(missing.status, 3, missing.stderr);
  assert.match(missing.stderr, /the control run could not be run \(ENOENT\)/);
  assert.equal(missing.stdout, '');
  untouched(b, 'a command that is not there');

  const taken = b.sweep();
  assert.equal(taken.status, 130, taken.stderr);
  assert.match(taken.stderr, /the control run was stopped by SIGKILL/);
  assert.equal(taken.stdout, '');
  untouched(b, 'a run a signal took');
});

test('the marker is taken away only where it is still the one the sweep made', () => {
  // Another hand puts its own marker in place while the suite runs: a file of
  // its own, renamed over the sweep's while the sweep's still exists.
  const replaced = box({
    'suite.js': 'const fs = require("fs");\n'
      + 'fs.writeFileSync(".marker-tmp", "someone else\\n");\n'
      + 'fs.renameSync(".marker-tmp", ".mutation-sweep-running");\n' + READS
  });
  const run = replaced.sweep();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(replaced.read('.mutation-sweep-running'), 'someone else\n', 'a marker someone else put down stays');
  assert.match(run.stdout, /src\.js is back as it was/);

  // Another hand takes the marker away: a marker already gone is not an error.
  const gone = box({
    'suite.js': 'const fs = require("fs");\nfs.rmSync(".mutation-sweep-running", { force: true });\n' + READS
  });
  const after = gone.sweep();
  assert.equal(after.status, 0, after.stderr);
  assert.doesNotMatch(after.stderr, /could not take its marker off/);
  assert.equal(gone.locked(), false);
});

test('a confirming command judges the survivors again, where it can', () => {
  const dropped = RULE_MUTANTS.filter((line) => line.includes('a guard body is dropped'));
  const rest = RULE_MUTANTS.filter((line) => !dropped.includes(line));
  const b = box({
    'confirm.js': onDroppedBody('process.exit(1);'),
    'ran.js': 'require("fs").writeFileSync("confirm-ran.txt", "");\nrequire("./src.js");\n',
    'idle.js': 'process.exit(0);\n',
    'red.js': `${READS}process.exit(1);\n`,
    'strict.js': KILLS_ALL
  });

  // It kills what it kills, and the rest stand.
  const confirmed = b.sweep({ MUTATE_CONFIRM: 'node confirm.js' });
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stderr, /confirming 19 survivors against: node confirm\.js/);
  assert.deepEqual(listed(confirmed, 'SURVIVED'), rest);
  assert.equal(summary(confirmed), 'src.js: 19 mutants, 0 did not parse, 19 run, 2 killed, 17 standing (0 of them hung)');
  untouched(b, 'a confirmed sweep');

  // One that does not execute the source, or is not green, leaves them as found.
  for (const [command, says] of [
    ['node idle.js', /the confirming command does not execute src\.js; the survivors stand as the sweep found them/],
    ['node red.js', /the confirming command is not green before any mutation is applied \(exit 1\); the survivors stand as the sweep found them/]
  ]) {
    const run = b.sweep({ MUTATE_CONFIRM: command });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, says);
    assert.deepEqual(listed(run, 'SURVIVED'), RULE_MUTANTS, `${command} kills nothing`);
    untouched(b, command);
  }

  // Without one, or with nothing standing, none is run.
  const plain = b.sweep();
  assert.doesNotMatch(plain.stderr, /confirming/);
  const none = b.sweep({ MUTATE_CONFIRM: 'node ran.js' }, 'node', 'strict.js');
  assert.equal(none.status, 0, none.stderr);
  assert.equal(summary(none), 'src.js: 19 mutants, 0 did not parse, 19 run, 19 killed, 0 standing (0 of them hung)');
  assert.doesNotMatch(none.stderr, /confirming/);
  assert.equal(b.has('confirm-ran.txt'), false, 'with nothing standing the confirming command is not run');
});

test('a run that takes longer than MUTATE_TIMEOUT_MS is reported as hung, and confirmed like a survivor', () => {
  const dropped = RULE_MUTANTS.filter((line) => line.includes('a guard body is dropped'));
  const b = box({
    'suite.js': onDroppedBody(WAITS),
    'kills.js': onDroppedBody('process.exit(1);'),
    'hangs.js': onDroppedBody(WAITS)
  });
  const hung = b.sweep({ MUTATE_TIMEOUT_MS: '1500' });
  assert.equal(hung.status, 0, hung.stderr);
  assert.deepEqual(listed(hung, 'HUNG'), dropped);
  assert.equal(summary(hung), 'src.js: 19 mutants, 0 did not parse, 19 run, 0 killed, 19 standing (2 of them hung)');
  untouched(b, 'a sweep with hung runs');

  // A confirming command that kills a hung mutant takes it off the hung count.
  const killed = b.sweep({ MUTATE_TIMEOUT_MS: '1500', MUTATE_CONFIRM: 'node kills.js' });
  assert.deepEqual(listed(killed, 'HUNG'), []);
  assert.equal(summary(killed), 'src.js: 19 mutants, 0 did not parse, 19 run, 2 killed, 17 standing (0 of them hung)');

  // One that runs out of time on it kills nothing.
  const still = b.sweep({ MUTATE_TIMEOUT_MS: '1500', MUTATE_CONFIRM: 'node hangs.js' });
  assert.deepEqual(listed(still, 'HUNG'), dropped);
  assert.equal(summary(still), 'src.js: 19 mutants, 0 did not parse, 19 run, 0 killed, 19 standing (2 of them hung)');
  untouched(b, 'a confirmed sweep with hung runs');
});
