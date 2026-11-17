require('../shared/.github/tests/issue-auto-assign.test.cjs');

const assert = require('node:assert/strict');
const { test } = require('node:test');
const groups = require('../groups.json');

test('only extensions taking the public group receive issue auto-assignment', () => {
  for (const file of ['.github/workflows/issue-auto-assign.yml', '.github/tests/issue-auto-assign.test.cjs']) {
    assert.ok(groups.public.includes(file));
    for (const [name, files] of Object.entries(groups)) {
      if (name !== 'public') assert.ok(!files.includes(file));
    }
  }
});
