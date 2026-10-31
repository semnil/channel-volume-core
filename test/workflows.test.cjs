// workflows.test.cjs — The shared workflows: every action is pinned, every job
// is bounded, a release runs what CI runs before it packs, the archive is
// checked on its way back, and each release step runs the script it names.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, shared } = require('./helpers.cjs');

const SHARED_WORKFLOWS = shared('.github', 'workflows');
const readWorkflow = (name) => fs.readFileSync(path.join(SHARED_WORKFLOWS, name), 'utf8');

// Every workflow file: the ones the extensions carry, and this repository's
// own where it has any.
function everyWorkflow() {
  const found = [];
  for (const dir of [SHARED_WORKFLOWS, path.join(ROOT, '.github', 'workflows')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((file) => /\.ya?ml$/.test(file)).sort()) {
      found.push({ name: path.relative(ROOT, path.join(dir, name)).split(path.sep).join('/'),
        text: fs.readFileSync(path.join(dir, name), 'utf8') });
    }
  }
  return found;
}

// One job of a workflow, from its key to the next job's.
function jobIn(file, name) {
  const text = readWorkflow(file);
  const at = text.indexOf(`\n  ${name}:`);
  assert.ok(at > -1, `${file} carries a ${name} job`);
  const rest = text.slice(at + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// A tag moves and a commit does not, so every action this repository runs is
// named by the commit its version tag names, with that version written beside
// it. Nothing here reaches the network: what the commit is was settled when it
// was written down, and this only holds the shape.
test('every action is named by a commit and the version beside it', () => {
  const files = everyWorkflow();
  assert.ok(files.length > 0, 'the repository carries workflows');
  let named = 0;
  for (const { name, text } of files) {
    for (const line of text.split('\n')) {
      if (!/^\s*-?\s*uses:/.test(line)) { continue; }
      named += 1;
      assert.match(line,
        /^\s*-?\s*uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/,
        `${name} names an action by a commit and the version beside it`);
    }
  }
  // Without this the loop above would pass over a workflow that runs nothing.
  assert.ok(named > 0, 'the workflows run actions');
});

// A job with no timeout of its own runs to GitHub's six hours, so one that
// hangs holds a runner for an afternoon and says nothing until it is looked at.
test('every job names how long it may run', () => {
  let jobs = 0;
  for (const { name, text } of everyWorkflow()) {
    assert.ok(text.includes('\njobs:'), `${name} has a jobs: block`);
    // A job is a key at one indent under jobs:, and its block runs to the next.
    const blocks = text.slice(text.indexOf('\njobs:')).split(/\n {2}(?=[\w-]+:)/).slice(1);
    assert.ok(blocks.length > 0, `${name} carries a job`);
    for (const block of blocks) {
      jobs += 1;
      // At the job's own indent: a step inside it naming one of its own
      // answers for the step and leaves the job running to GitHub's six hours.
      assert.match(block, /^ {4}timeout-minutes: \d+$/m,
        `${name}'s ${block.split(':')[0]} names how long it may run`);
    }
  }
  // Without this the loop above would pass over a repository with no jobs in it.
  assert.ok(jobs > 2, `the workflows carry jobs — found ${jobs}`);
});

// A step that reaches a host outside GitHub (a package index, Codecov, a
// download) names how long it may run, so that the step that hung is the
// one the run names rather than the job.
const OUTSIDE = [/^ {8}uses: codecov\//m, /\bpip3? install\b/, /\bnpm (install|ci)\b/, /\bapt-get\b/, /\bcurl\b/, /\bwget\b/];
test('every step that reaches outside GitHub names how long it may run', () => {
  let outside = 0;
  for (const { name, text } of everyWorkflow()) {
    for (const step of text.split(/\n {6}- /).slice(1)) {
      if (!OUTSIDE.some((pattern) => pattern.test(step))) continue;
      outside += 1;
      assert.match(step, /^ {8}timeout-minutes: \d+$/m,
        `${name}'s step "${(step.match(/name: (.*)/) || step.match(/uses: (\S+)/) || [step, step.split('\n')[0]])[1]}" names how long it may run`);
    }
  }
  // Without this the loop above would pass over workflows that reach nothing.
  assert.ok(outside > 2, `the workflows reach outside GitHub — found ${outside}`);
});

// A release is built from whatever commit its tag names: a build that packs
// without running what CI runs turns a commit CI never passed into a release
// asset. The two are held together here
// rather than by whoever remembers to copy a step across.
test('a release is built from a commit that passed what CI runs', () => {
  // A step run only where something already failed is a way of looking at the
  // failure, not a check the tree has to pass; nor is the coverage report, which
  // turns what the tests ran into what CI uploads.
  const checksOf = (job) => job.split(/\n {6}- /).slice(1)
    .filter((step) => !/^\s*if: failure\(\)/m.test(step))
    .map((step) => step.match(/^\s*run: (.+)$/m)).filter(Boolean)
    .map((match) => match[1].trim())
    .filter((run) => !run.startsWith('node tools/coverage/'));
  const ci = checksOf(jobIn('ci.yaml', 'test'));
  const build = jobIn('release.yaml', 'build');
  // The step, not the line inside it: the pack runs in a script now, so a
  // reader looking for one `run:` line stops finding it.
  const packs = build.indexOf('- name: Pack Extension');
  assert.ok(packs > -1, 'the release build has a step that packs the extension');
  assert.ok(build.includes('python pack.py'), 'and that step runs the packer');
  assert.ok(ci.length > 3, `the CI job runs checks — found ${ci.join(', ')}`);
  for (const check of ci) {
    const at = build.indexOf(`run: ${check}`);
    assert.ok(at > -1, `the release build runs what CI runs: ${check}`);
    assert.ok(at < packs, `the release build runs ${check} before it packs`);
  }
  // A failed upload ends the job, so every check runs ahead of it, and an upload
  // that fails never hides whether the tree passes the checks.
  const testJob = jobIn('ci.yaml', 'test');
  const uploads = testJob.indexOf('uses: codecov/codecov-action@');
  assert.ok(uploads > -1, 'the CI job uploads coverage');
  for (const check of ci) {
    assert.ok(testJob.indexOf(`run: ${check}`) < uploads, `CI runs ${check} before it uploads coverage`);
  }
});

// A step guarded by hashFiles runs where the extension carries the file and is
// skipped, as a success, where it does not. A guard naming another file than
// the one its step runs skips that step everywhere.
test('a step run only where its file is carried names the file it runs', () => {
  let guarded = 0;
  for (const [file, job] of [['ci.yaml', 'test'], ['release.yaml', 'build']]) {
    for (const step of jobIn(file, job).split(/\n {6}- /).slice(1)) {
      const guard = step.match(/^\s*if: hashFiles\('([^']+)'\) != ''$/m);
      if (!guard) continue;
      guarded += 1;
      const run = step.match(/^\s*run: (.+)$/m);
      assert.ok(run, `${file}'s step guarded on ${guard[1]} runs something`);
      assert.ok(run[1].split(/\s+/).includes(guard[1]),
        `${file}'s step guarded on ${guard[1]} runs that file — ${run[1]}`);
    }
  }
  // Without this the loop above would pass over workflows that guard nothing.
  assert.ok(guarded > 0, 'the workflows guard a step on a file');
});

// The archive the build packed has to come back from the download under the
// same name and the same bytes. The upload and the download are reached by no
// other run — a pull request skips the one in CI, which only draws on failure
// — so without this round trip nothing exercises them until a release.
test('the archive comes back from the download as it went', () => {
  const release = readWorkflow('release.yaml');
  const build = release.slice(release.indexOf('\n  build:'), release.indexOf('\n  release:'));
  for (const [what, where, text] of [
    ['names what it packed', 'the build job', build.includes('archive=${built[0]}')],
    ['weighs what it packed', 'the build job', build.includes('sha256sum')],
    ['refuses to pack more than one archive', 'the build job',
      /packing left \$\{#built\[@\]\} archives/.test(build)],
    ['hands both on', 'the build job', /outputs:[\s\S]*?archive:[\s\S]*?digest:/.test(build)]
  ]) {
    assert.ok(text, `${where} ${what}`);
  }
  const round = release.slice(release.indexOf('\n  release:'));
  assert.ok(round.includes('needs.build.outputs.archive') && round.includes('needs.build.outputs.digest'),
    'the release job reads the name and the digest the build recorded');
  // Found, then ordered: indexOf gives -1 for a name that is not there, and
  // -1 is less than anything, so the ordering alone passes over a check that
  // has been deleted.
  const compares = round.indexOf('PACKED_DIGEST}" ]]; then');
  const releases = round.indexOf('- name: Create Release');
  assert.ok(compares > -1, 'the release job compares the digest it was handed');
  assert.ok(releases > -1, 'the release job has a step that makes the release');
  assert.ok(compares < releases, 'and it compares before it makes one');
  // The flag belongs to the step that makes the release, not to the job. On
  // the job it takes the download and the comparison with it, so a
  // hand-started run checks nothing and still reports success — and the
  // earlier reading of this compared two positions in a way that passed
  // exactly then, because a job-level `if:` sits before the first step.
  const header = round.slice(0, round.indexOf('\n    steps:'));
  assert.ok(!header.includes('validTag'),
    'the release job runs whether or not a release is being made');
  const steps = round.slice(round.indexOf('\n    steps:')).split(/\n      - (?=name:|uses:)/).slice(1);
  const makesRelease = steps.filter(step => step.includes('action-gh-release'));
  assert.ok(makesRelease.length === 1,
    `one step makes the release — found ${makesRelease.length}`);
  assert.ok(makesRelease[0]?.includes("needs.check-event.outputs.validTag == 'true'"),
    'and it is the step standing on the flag');
  const standing = steps.filter(step => step.includes('validTag'));
  assert.ok(standing.length === 1,
    `nothing else in the job stands on it — ${standing.length} step(s) do`);
});

// A step that stopped calling a release script would leave every case of that
// script's own test passing.
test('the release workflow runs the version script and the tag script', () => {
  const release = readWorkflow('release.yaml');
  assert.ok(fs.existsSync(shared('tools', 'verify-version.sh')), 'the release script is in the tree');
  assert.ok(release.includes('tools/verify-version.sh'),
    'the release workflow runs the version script');
  assert.ok(fs.existsSync(shared('tools', 'check-tag.sh')), 'the tag script is in the tree');
  assert.ok(release.includes('tools/check-tag.sh'),
    'the release workflow runs the tag script');
});

// A merged version bump is a release. tag-release.yaml runs when CI passes on
// main, asks tools/tag-plan.sh whether the commit moved the version, tags it and
// starts release.yaml on the tag.
test('a merged version bump is tagged and released, as the workflows say', () => {
  const check = (ok, message) => assert.ok(ok, message);
  const tagRelease = readWorkflow('tag-release.yaml');
  const release = readWorkflow('release.yaml');
  const ci = readWorkflow('ci.yaml');

  // The workflow: CI on a push to main, then tag and dispatch.
  check(/^name: CI\n/.test(ci) && /\n {2}push:\n {4}branches: \[main\]\n/.test(ci),
    'CI is named CI and runs on a push to main');
  check(/\non:\n {2}workflow_run:\n {4}workflows: \[CI\]\n {4}types: \[completed\]\n {4}branches: \[main\]\n/.test(tagRelease),
    'tag-release runs when CI completes on main');
  check(tagRelease.includes("if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'"),
    'tag-release tags only after a successful CI run of a push');
  check(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}\n {10}fetch-depth: 0\n/.test(tagRelease),
    'tag-release checks out the commit CI reported on, with its history');
  check(/\npermissions:\n {2}contents: write[^\n]*\n {2}actions: write[^\n]*\n\n/.test(tagRelease),
    'tag-release may push a tag and dispatch the release, and nothing more');
  check(/\nconcurrency:\n {2}group: tag-release-\$\{\{ github\.event\.workflow_run\.head_sha \}\}\n {2}cancel-in-progress: false\n/.test(tagRelease),
    'one merge does not cancel the tagging of another');
  check(/\n {4}timeout-minutes: \d+/.test(tagRelease), 'the tag job has a timeout');
  check(!/--force|\s-f\b|--delete|git tag -d/.test(tagRelease), 'tag-release never moves or deletes a tag');
  check(tagRelease.includes('bash tools/tag-plan.sh "\${HEAD_SHA}"'), 'tag-release asks tools/tag-plan.sh about the commit CI reported on');
  check(tagRelease.includes('gh workflow run release.yaml --ref "\${tag}"'), 'tag-release dispatches release.yaml on the tag');
  check(/\n {2}workflow_dispatch:\n/.test(release), 'release.yaml can be dispatched');
  check(/\nconcurrency:\n {2}group: release-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false\n/.test(release),
    'release.yaml runs one release per ref at a time');
  check(fs.readFileSync(shared('tools', 'check-tag.sh'), 'utf8').includes('ref_type="\${1:-\${GITHUB_REF_TYPE:-}}"'),
    'check-tag decides by the ref type, so a dispatch on a tag releases');
});

// A run that is not making a release has a branch name where the tag would be,
// so the tag and the manifest are compared exactly where a release is made
// from them — which is the flag create-release is already gated on.
test('the tag is compared with the manifest where a release is made', () => {
  const release = readWorkflow('release.yaml');
  const gate = "if: needs.check-event.outputs.validTag == 'true'";
  const gated = release.split('\n').filter((line) => line.trim() === gate).length;
  assert.equal(gated, 2,
    `the version check and the release read one flag — found ${gated} line(s) reading it`);
  const verify = release.indexOf('run: bash tools/verify-version.sh');
  assert.ok(verify > -1, 'the release workflow runs the version script');
  assert.ok(release.lastIndexOf(gate, verify) > release.lastIndexOf('- name:', verify),
    'the version check is the step that flag stands on');
});

test('CI uploads the screenshots the runner drew, not the ones it checked out', () => {
  const workflow = readWorkflow('ci.yaml');
  assert.match(workflow, /run: python3 gen_screenshots\.py --check/);
  const redrawInto = workflow.match(/gen_screenshots\.py --out (.+)/);
  const uploads = workflow.match(/path: (.+)\n\s+if-no-files-found/);
  assert.ok(redrawInto && uploads, 'the redraw and the upload each name a directory');
  const dir = (text) => text.trim().replace(/\/$/, '');
  assert.equal(dir(uploads[1]), dir(redrawInto[1]), 'the upload takes the directory that was redrawn');
  assert.ok(!redrawInto[1].includes('docs/screenshots'),
    'the redraw does not write over the tracked images');
  // A condition without a status function is treated as success-only, so it
  // would never run after the step it answers to has failed.
  assert.match(workflow, /if: failure\(\) && steps\.screenshots\.conclusion == 'failure'/);
  assert.match(workflow, /if: failure\(\) && steps\.redraw\.conclusion == 'success'/);
  // A condition on a step id that no step carries is never true, and the job is
  // already red by then, so nothing points it out.
  for (const [, id] of workflow.matchAll(/steps\.(\w+)\.conclusion/g)) {
    assert.match(workflow, new RegExp(`^\\s+id: ${id}$`, 'm'), `a step carries id: ${id}`);
  }
  // Uploading nothing is the case worth failing on: it means the redraw wrote
  // somewhere else.
  assert.match(workflow, /if-no-files-found: error/);
});

test('CI has Pillow before it runs the suite that needs it', () => {
  const job = jobIn('ci.yaml', 'test');
  const installed = job.indexOf('pip install pillow==');
  const suite = job.indexOf('run: node test.js');
  assert.ok(installed > -1 && suite > -1, 'the test job installs pillow and runs the suite');
  // The runs that hand the generator a tree it has to turn down skip
  // themselves where it cannot draw, and a skipped run holds nothing.
  assert.ok(installed < suite, 'pillow is installed before node test.js');
});
