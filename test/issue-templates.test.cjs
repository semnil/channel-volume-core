// issue-templates.test.cjs — The shared issue templates are written in English
// and carry one line saying Japanese is welcome.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { shared } = require('./helpers.cjs');

test('the issue templates are English, with the note that says Japanese is welcome', () => {
  const directory = shared('.github', 'ISSUE_TEMPLATE');
  const templates = fs.readdirSync(directory).filter((name) => name.endsWith('.md'));
  assert.ok(templates.length > 0, 'there are issue templates to read');
  for (const name of templates) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    const note = text.split('\n').filter((line) => line.includes('日本語で構いません'));
    assert.equal(note.length, 1, `${name} carries the note that Japanese is welcome`);
    const rest = text.split('\n').filter((line) => !line.includes('日本語で構いません')).join('\n');
    assert.ok(!/[぀-ヿ一-鿿]/.test(rest),
      `${name} is English apart from that note`);
  }
});
