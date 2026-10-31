// coverage-copies.test.cjs — coverage-copies.mjs gives a script run from a
// test's copy of a mutation tool the shared file's URL, and leaves every other
// script as it was.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

const SCRIPT = path.join(__dirname, '..', 'coverage-copies.mjs');

test('coverage-copies.mjs counts a copy of a mutation tool as the shared file, and nothing else', (t) => {
  const box = tempDir('cv-copies-');
  const elsewhere = tempDir('copies-elsewhere-');
  t.after(() => {
    fs.rmSync(box, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  const url = (...parts) => pathToFileURL(path.join(...parts)).href;
  const script = (at) => ({ scriptId: '1', url: at, functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: 3, count: 1 }], isBlockCoverage: false }] });
  const v8 = path.join(box, 'v8');
  fs.mkdirSync(v8);
  const kept = [
    url(box, 'tools', 'mutation', 'not-shared.mjs'),
    url(box, 'sub', 'tools', 'mutation', 'bail.mjs'),
    url(box, 'tools', 'mutation', 'sweep.mjs', 'inner.mjs'),
    url(box, 'other', 'mutation', 'sweep.mjs'),
    url(box, 'tools', 'other', 'sweep.mjs'),
    url(elsewhere, 'tools', 'mutation', 'bail.mjs'),
    url(shared('tools', 'mutation', 'bail.mjs')),
    'node:internal/main/run_main_module',
    'evalmachine.<anonymous>'
  ];
  fs.writeFileSync(path.join(v8, 'coverage-1.json'), JSON.stringify({
    result: [script(url(box, 'tools', 'mutation', 'sweep.mjs')), ...kept.map(script)]
  }));
  const untouched = JSON.stringify({ result: kept.map(script) });
  fs.writeFileSync(path.join(v8, 'coverage-2.json'), untouched);
  fs.writeFileSync(path.join(v8, 'notes.txt'), 'not coverage');

  const ran = spawnSync('node', [SCRIPT, v8], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stdout, '1 scripts run from copies counted as shared/tools/mutation/ files\n');
  const moved = JSON.parse(fs.readFileSync(path.join(v8, 'coverage-1.json'), 'utf8')).result;
  assert.deepEqual(moved.map((entry) => entry.url), [url(shared('tools', 'mutation', 'sweep.mjs')), ...kept],
    'the copy in a cv- box takes the shared file\'s URL, and the rest keep theirs');
  assert.deepEqual(moved[0].functions, script('').functions, 'what the copy ran is kept');
  assert.equal(fs.readFileSync(path.join(v8, 'coverage-2.json'), 'utf8'), untouched, 'a file with no copy in it is not rewritten');
  assert.equal(fs.readFileSync(path.join(v8, 'notes.txt'), 'utf8'), 'not coverage', 'what is not coverage is not read');
});

test('coverage-copies.mjs refuses a run with no coverage directory', () => {
  const ran = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /^usage: node coverage-copies\.mjs <coverage dir>/);
});
