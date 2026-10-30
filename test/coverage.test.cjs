// coverage.test.cjs — tools/coverage/v8-to-lcov.mjs, the lcov report CI
// uploads, counts what a source ran and no other script.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

const CONVERTER = shared('tools', 'coverage', 'v8-to-lcov.mjs');
// A converter that never ends fails the test rather than holding the suite.
const TIMEOUT = 30000;

function convert(box, args) {
  return spawnSync('node', [CONVERTER, ...args], { cwd: box, encoding: 'utf8', timeout: TIMEOUT });
}

// The lcov report, by source: the lines reported, the ones run, the ones
// partly run, and the totals the record closes with.
function readReport(file) {
  const files = {};
  let at = null;
  for (const row of fs.readFileSync(file, 'utf8').split('\n')) {
    if (row.startsWith('SF:')) files[at = row.slice(3)] = { lines: [], run: [], partly: [], totals: {} };
    else if (row.startsWith('DA:')) {
      const [line, count] = row.slice(3).split(',').map(Number);
      files[at].lines.push(line);
      if (count > 0) files[at].run.push(line);
    } else if (row.startsWith('BRDA:') && row.endsWith(',-')) {
      files[at].partly.push(Number(row.slice(5).split(',')[0]));
    } else if (/^(BRF|BRH|LF|LH):/.test(row)) {
      const [key, value] = row.split(':');
      files[at].totals[key] = Number(value);
    }
  }
  return files;
}

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
    // Whatever else sits beside V8's own files is not read as coverage.
    fs.writeFileSync(path.join(v8Dir, 'notes.txt'), 'not coverage');
    const converted = convert(box, [v8Dir, 'out.info', 'src.js', 'unused.js']);
    assert.equal(converted.status, 0, converted.stderr);

    const files = readReport(path.join(box, 'out.info'));
    assert.deepEqual(files['src.js'].lines, [2, 3, 4, 5, 6, 7, 8, 9],
      'every line of code is reported and the comment is not');
    assert.deepEqual(files['src.js'].run, [2, 3, 4, 5, 9],
      'what the source ran is counted, and the copies that call never() are not');
    assert.deepEqual(files['src.js'].partly, [3],
      'a line part of which did not run is reported as partly run');
    assert.deepEqual(files['src.js'].totals, { BRF: 2, BRH: 1, LF: 8, LH: 5 },
      'the record closes with the counts of what it reported');
    assert.deepEqual(files['unused.js'], { lines: [1, 4], run: [], partly: [], totals: { BRF: 0, BRH: 0, LF: 2, LH: 0 } },
      'a source nothing loaded is reported with every line unrun');
    assert.equal(converted.stdout,
      'src.js\tscripts 1\tlines 5/8\tpartly run 1\nunused.js\tscripts 0\tlines 0/2\tpartly run 0\n',
      'the summary names each source with the scripts counted for it');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

// What a line holds is read the way JavaScript reads it: a comment marker in a
// string, a template literal or a regular expression is code, a slash after a
// value is a division, and a line holding only a comment, or only whitespace,
// is not reported. Each misreading here would turn a comment line into code or
// a code line into comment, so it shows in which lines are reported.
test('v8-to-lcov tells comments from strings, templates, regular expressions and division', () => {
  const box = tempDir('cv-coverage-mask-');
  const write = (name, text) => fs.writeFileSync(path.join(box, name), text);
  const lines = [
    /* 1 */ 'let a = 4, b = 2, c = [1], $ = 1;',
    /* 2 */ 'a = a / b; /* after a word',
    /* 3 */ 'only a comment */',
    /* 4 */ 'a = (a) / b; /* after a parenthesis',
    /* 5 */ 'only a comment */',
    /* 6 */ 'a = c[0] / b; /* after a bracket',
    /* 7 */ 'only a comment */',
    /* 8 */ 'a = $ / b; /* after a dollar',
    /* 9 */ 'only a comment */',
    /* 10 */ 'const s1 = "\\"/*";',
    /* 11 */ 'a = 1;',
    /* 12 */ "const s2 = '\\'/*';",
    /* 13 */ 'a = 2;',
    /* 14 */ 'const t1 = `',
    /* 15 */ '// inside a template',
    /* 16 */ '`;',
    /* 17 */ 'const r1 = /[/`]/;',
    /* 18 */ '// only a comment',
    /* 19 */ 'const r2 = /\\/\\*/;',
    /* 20 */ 'a = 3;',
    /* 21 */ 'const s3 = "x" / 1 || 0; /* after a string',
    /* 22 */ 'only a comment */',
    /* 23 */ '   ',
    /* 24 */ '/* one line */',
    /* 25 */ 'a = 4; /* closes on its own line',
    /* 26 */ '*/',
    /* 27 */ 'a = a / b;',
    /* 28 */ 'a = 5;',
    /* 29 */ '/* closes on the line it opens */',
    /* 30 */ 'const r3 = /[a]/; /* a regular expression, then a comment',
    /* 31 */ 'only a comment */'
  ];
  write('mask.js', lines.join('\n') + '\n');
  // Never loaded, and not JavaScript a loader would take: a comment that does
  // not close runs to the end of the source.
  write('open.js', 'x = 1;\n/* never closed\ny = 2;\n');
  write('run.cjs', "require('vm').runInNewContext(require('fs').readFileSync('mask.js', 'utf8'), {}, { filename: 'mask.js' });\n");
  const v8Dir = path.join(box, 'v8');
  try {
    const ran = spawnSync('node', ['run.cjs'],
      { cwd: box, encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: v8Dir } });
    assert.equal(ran.status, 0, ran.stderr);
    const converted = convert(box, [v8Dir, 'out.info', 'mask.js', 'open.js']);
    assert.equal(converted.status, 0, converted.stderr);
    const files = readReport(path.join(box, 'out.info'));
    const code = [1, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 25, 27, 28, 30];
    assert.deepEqual(files['mask.js'].lines, code, 'the lines reported are the lines holding code');
    assert.deepEqual(files['mask.js'].run, code, 'and every one of them ran');
    assert.deepEqual(files['open.js'].lines, [1], 'a comment that never closes runs to the end');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

test('v8-to-lcov refuses a command line that names no source', () => {
  const box = tempDir('cv-coverage-usage-');
  try {
    for (const args of [[], ['v8'], ['v8', 'out.info'], ['', 'out.info', 'src.js'], ['v8', '', 'src.js']]) {
      const converted = convert(box, args);
      assert.equal(converted.status, 2, `exit for ${JSON.stringify(args)}`);
      assert.match(converted.stderr, /^usage: v8-to-lcov\.mjs <coverage dir> <lcov out> <source>\.\.\./);
      assert.equal(fs.existsSync(path.join(box, 'out.info')), false, 'and writes no report');
    }
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});

// Only a script whose top-level range covers the whole source is counted. V8
// writes the script's own range first and from offset 0; an entry shaped any
// other way is passed over rather than read as the source's.
test('v8-to-lcov passes over a script whose ranges do not cover the source', () => {
  const box = tempDir('cv-coverage-shape-');
  const source = 'const x = 1;\nx;\n';
  fs.writeFileSync(path.join(box, 'src.js'), source);
  const v8Dir = path.join(box, 'v8');
  fs.mkdirSync(v8Dir);
  const url = require('node:url').pathToFileURL(path.join(box, 'src.js')).href;
  const scripts = [
    { url, functions: [] },
    { url, functions: [{ ranges: [] }] },
    { url, functions: [{ ranges: [{ startOffset: 1, endOffset: source.length, count: 1 }] }] },
    { url, functions: [{ ranges: [{ startOffset: 0, endOffset: source.length - 1, count: 1 }] }] }
  ];
  fs.writeFileSync(path.join(v8Dir, 'coverage-1.json'), JSON.stringify({ result: scripts }));
  try {
    const converted = convert(box, [v8Dir, 'out.info', 'src.js']);
    assert.equal(converted.status, 0, converted.stderr);
    assert.equal(converted.stdout, 'src.js\tscripts 0\tlines 0/2\tpartly run 0\n',
      'none of the four is counted as the source');
    // The control: the same entry covering the whole source is counted.
    scripts.push({ url, functions: [{ ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }] });
    fs.writeFileSync(path.join(v8Dir, 'coverage-1.json'), JSON.stringify({ result: scripts }));
    const counted = convert(box, [v8Dir, 'out.info', 'src.js']);
    assert.equal(counted.stdout, 'src.js\tscripts 1\tlines 2/2\tpartly run 0\n');
  } finally {
    fs.rmSync(box, { recursive: true, force: true });
  }
});
