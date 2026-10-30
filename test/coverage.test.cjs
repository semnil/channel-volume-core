// coverage.test.cjs — tools/coverage/v8-to-lcov.mjs, the lcov report CI
// uploads, counts what a source ran and no other script.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

test('v8-to-lcov counts what the source ran, and no other script', () => {
  // tools/coverage/v8-to-lcov.mjs makes the lcov report from the coverage V8
  // writes. A box of its own runs a source under NODE_V8_COVERAGE beside two
  // scripts the report does not count — a copy of the source at another path,
  // and an edited copy under its name — each of which calls the function the
  // source itself never calls.
  const box = tempDir('cv-coverage-');
  const write = (name, text) => fs.writeFileSync(path.join(box, name), text);
  const source = '// a comment\nfunction pick(a, b) {\n  if (!a) return b;\n  return a;\n}\n'
    + 'function never() {\n  return 0;\n}\npick(1, 2);\n';
  write('src.js', source);
  write('unused.js', 'const x = 1;\n\n// none\nx;\n');
  fs.mkdirSync(path.join(box, 'other'));
  write('other/src.js', source.replace('pick(1, 2);', 'never(   );'));
  write('run.cjs', [
    "const text = require('fs').readFileSync('src.js', 'utf8');",
    "require('vm').runInNewContext(text, {}, { filename: 'src.js' });",
    "require('vm').runInNewContext(text + 'never();\\n', {}, { filename: 'src.js' });",
    "require('./other/src.js');"
  ].join('\n'));
  const v8Dir = path.join(box, 'v8');
  try {
    const ran = spawnSync('node', ['run.cjs'],
      { cwd: box, encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: v8Dir } });
    assert.equal(ran.status, 0, ran.stderr);
    const converted = spawnSync('node',
      [shared('tools', 'coverage', 'v8-to-lcov.mjs'), v8Dir, 'out.info', 'src.js', 'unused.js'],
      { cwd: box, encoding: 'utf8' });
    assert.equal(converted.status, 0, converted.stderr);

    const files = {};
    let at = null;
    for (const row of fs.readFileSync(path.join(box, 'out.info'), 'utf8').split('\n')) {
      if (row.startsWith('SF:')) files[at = row.slice(3)] = { lines: [], run: [], partly: [] };
      else if (row.startsWith('DA:')) {
        const [line, count] = row.slice(3).split(',').map(Number);
        files[at].lines.push(line);
        if (count > 0) files[at].run.push(line);
      } else if (row.startsWith('BRDA:') && row.endsWith(',-')) {
        files[at].partly.push(Number(row.slice(5).split(',')[0]));
      }
    }
    assert.deepEqual(files['src.js'].lines, [2, 3, 4, 5, 6, 7, 8, 9],
      'every line of code is reported and the comment is not');
    assert.deepEqual(files['src.js'].run, [2, 3, 4, 5, 9],
      'what the source ran is counted, and the copies that call never() are not');
    assert.deepEqual(files['src.js'].partly, [3],
      'a line part of which did not run is reported as partly run');
    assert.deepEqual(files['unused.js'], { lines: [1, 4], run: [], partly: [] },
      'a source nothing loaded is reported with every line unrun');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});
