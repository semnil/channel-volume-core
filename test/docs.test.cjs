// docs.test.cjs — docs/shared-files.md and its Japanese counterpart name
// everything core/common.js declares at the top level and everything
// core/loudness.js and its meter hand out, and carry the same anchors for the
// extensions' documents to link to.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { shared } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const DOCS = ['docs/shared-files.md', 'docs/shared-files.ja.md'];

function topLevelNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^(?:async function|function|const|let|class) (\w+)/gm)) names.add(match[1]);
  return [...names];
}

function anchors(text) {
  return [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]);
}

test('the shared files document, in both languages, names every top-level declaration of core/common.js', () => {
  const names = topLevelNames(fs.readFileSync(shared('core', 'common.js'), 'utf8'));
  assert.ok(names.includes('readSettings') && names.includes('bindPresets'), 'the declarations are read');
  for (const doc of DOCS) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    const missing = names.filter((name) => !text.includes('`' + name + '`'));
    assert.deepEqual(missing, [], `${doc} names each of them`);
  }
});

test('the shared files document, in both languages, names what core/loudness.js and its meter hand out', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(shared('core', 'loudness.js'), 'utf8'), context);
  const api = vm.runInContext('channelVolumeLoudness', context);
  const names = ['channelVolumeLoudness', ...Object.keys(api), ...Object.keys(api.createMeter())];
  assert.ok(names.includes('createMeter') && names.includes('removeRecentWindows'), 'the names are read');
  for (const doc of DOCS) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    const missing = names.filter((name) => !new RegExp('`' + name + '[`(]').test(text));
    assert.deepEqual(missing, [], `${doc} names each of them`);
  }
});

test('the two languages of the shared files document carry the same anchors, in the same order', () => {
  const [en, ja] = DOCS.map((doc) => anchors(fs.readFileSync(path.join(ROOT, doc), 'utf8')));
  assert.ok(en.length > 0, 'the English document has anchors');
  assert.equal(new Set(en).size, en.length, 'no anchor is used twice');
  assert.deepEqual(ja, en);
});
