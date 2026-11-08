// dependabot-auto-merge.test.cjs — This repository runs the shared
// dependabot-auto-merge.yml as its own workflow: the copy under
// .github/workflows is the shared file but for the commits and versions its
// `uses:` lines name, and it passes the shared test of that workflow,
// dependabot-auto-merge-test.sh.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, shared } = require('./helpers.cjs');

const OWN = path.join(ROOT, '.github', 'workflows', 'dependabot-auto-merge.yml');
const SHARED = shared('.github', 'workflows', 'dependabot-auto-merge.yml');
const SHARED_TEST = shared('.github', 'tests', 'dependabot-auto-merge-test.sh');

// The case that runs the shared test skips where yq is not on PATH, except on
// GitHub Actions, where it runs.
const NO_YQ = process.env.GITHUB_ACTIONS !== 'true'
  && Boolean(spawnSync('yq', ['--version'], { encoding: 'utf8' }).error)
  && 'yq is not on PATH';

// A workflow with the commit and version of each action it names left out.
const withoutPins = (text) => text.replace(/^(\s*-?\s*uses:\s+[\w.-]+\/[\w.-]+)@[0-9a-f]{40} # v\d+\.\d+\.\d+$/gm, '$1');

test("this repository's auto-merge workflow is the shared one but for the actions' commits", () => {
  const own = fs.readFileSync(OWN, 'utf8');
  const copied = fs.readFileSync(SHARED, 'utf8');
  assert.match(own, /^\s*-?\s*uses:\s+dependabot\/fetch-metadata@[0-9a-f]{40} # v/m,
    'the copy names fetch-metadata by a commit');
  assert.equal(withoutPins(own), withoutPins(copied),
    '.github/workflows/dependabot-auto-merge.yml differs from shared/.github/workflows/dependabot-auto-merge.yml');
});

test("this repository's auto-merge workflow passes the shared workflow's test", { skip: NO_YQ }, () => {
  const run = spawnSync('bash', [SHARED_TEST], {
    encoding: 'utf8', env: { ...process.env, WORKFLOW_FILE: OWN },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const summary = run.stdout.match(/^(\d+) checks, 0 failed$/m);
  assert.ok(summary && Number(summary[1]) > 0, `the test ran its checks: ${run.stdout}`);
});
