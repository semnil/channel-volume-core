// codeowners.test.cjs — This repository's .github/CODEOWNERS is the shared
// one, so each pull request here, Dependabot's included, asks the owner the
// extensions name for a review.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, shared } = require('./helpers.cjs');

test("this repository's CODEOWNERS is the shared one", () => {
  const own = fs.readFileSync(path.join(ROOT, '.github', 'CODEOWNERS'), 'utf8');
  assert.match(own, /^\* @\S+$/m, 'it names an owner for every path');
  assert.equal(own, fs.readFileSync(shared('.github', 'CODEOWNERS'), 'utf8'),
    '.github/CODEOWNERS differs from shared/.github/CODEOWNERS');
});
