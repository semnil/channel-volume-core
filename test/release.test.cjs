// release.test.cjs — The scripts a release runs: verify-version.sh holds a tag
// to the manifest, check-tag.sh refuses a tag naming no release, tag-plan.sh
// names the tag a merged version bump asks for, and tag-release.yaml's step
// tags and dispatches on what tag-plan.sh says.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shared, withFixtureDir } = require('./helpers.cjs');

// What version a tag stands for. Chrome reads the manifest's version as numbers
// alone, so a prerelease shows its name in version_name and keeps the numbers it
// is built on in version. The release runs this script, so this runs it too.
test('a tag is met by the version the manifest shows for it', () => {
  const script = shared('tools', 'verify-version.sh');
  assert.ok(fs.existsSync(script), 'the release script is in the tree');

  withFixtureDir('cv-version-', (box) => {
    const ask = (manifest, tag) => {
      const at = path.join(box, 'manifest.json');
      fs.writeFileSync(at, JSON.stringify(manifest));
      return spawnSync('bash', [script, at, tag], { encoding: 'utf8' });
    };
    for (const [shape, manifest, tag, wanted] of [
      ['a release tag against a numeric version',
        { version: '1.2.0' }, 'v1.2.0', null],
      ['a prerelease tag against the name beside the version',
        { version: '1.2.0', version_name: '1.2.0-rc1' }, 'v1.2.0-rc1', null],
      ['a release tag against a name equal to the version',
        { version: '1.0.1', version_name: '1.0.1' }, 'v1.0.1', null],
      ['an alpha tag on the same numbers',
        { version: '1.0.1', version_name: '1.0.1-alpha' }, 'v1.0.1-alpha', null],
      ['a beta tag on the same numbers',
        { version: '1.0.1', version_name: '1.0.1-beta2' }, 'v1.0.1-beta2', null],
      ['an rc tag on the same numbers',
        { version: '1.0.1', version_name: '1.0.1-rc1' }, 'v1.0.1-rc1', null],
      ['a tag that is not the version', { version: '1.2.0' }, 'v1.2.1',
        /does not match tag/],
      ['a release tag against a manifest showing a prerelease',
        { version: '1.2.0', version_name: '1.2.0-rc1' }, 'v1.2.0', /does not match tag/],
      ['a name that is not built on the version',
        { version: '1.2.0', version_name: '9.9.9-rc1' }, 'v9.9.9-rc1',
        /does not begin with version/],
      ['a name whose numbers only start with the version',
        { version: '1.0.1', version_name: '1.0.10-rc1' }, 'v1.0.10-rc1',
        /does not begin with version/],
      ['a manifest naming no version', { name: 'p' }, 'v1.2.0', /names no version/]
    ]) {
      const run = ask(manifest, tag);
      const said = (run.stdout || '') + (run.stderr || '');
      if (wanted === null) {
        assert.equal(run.status, 0, `${shape} passes — ${said.trim()}`);
      } else {
        assert.notEqual(run.status, 0, `${shape} is refused`);
        assert.match(said, wanted, `${shape} says why`);
      }
    }
  });
});

// A run on a tag is an intent to release. A tag naming no release this workflow
// makes used to pass through as a run that packed, uploaded and released
// nothing — a green tick against a tag with no release behind it.
test('a tag naming no release is refused before anything is built', () => {
  const script = shared('tools', 'check-tag.sh');
  assert.ok(fs.existsSync(script), 'the tag script is in the tree');

  withFixtureDir('cv-tag-', (box) => {
    const ask = (refType, ref) => {
      const out = path.join(box, 'out');
      fs.writeFileSync(out, '');
      const run = spawnSync('bash', [script], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: ref,
          GITHUB_OUTPUT: out, RUNNER_DEBUG: '' }
      });
      return { run, wrote: fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean) };
    };
    let released = 0;
    for (const [refType, ref, wanted] of [
      ['tag', 'v1.2.3', ['validTag=true', 'prerelease=false', 'version=v1.2.3']],
      ['tag', 'v1.2.3-rc1', ['validTag=true', 'prerelease=true', 'version=v1.2.3-rc1']],
      ['tag', 'v1.2.3-beta2', ['validTag=true', 'prerelease=true', 'version=v1.2.3-beta2']],
      ['tag', 'v1.2.3-alpha', ['validTag=true', 'prerelease=true', 'version=v1.2.3-alpha']],
      // A run on a branch carries a branch name here and makes no
      // release, which is not a failure — it is what the flag is for.
      ['branch', 'main', ['validTag=false']],
      ['branch', 'v1.2.3', ['validTag=false']],
      // Four parts, two parts, and a word the prerelease arm does not name.
      ['tag', 'v1.2.3.4', null],
      ['tag', 'v1.2', null],
      ['tag', 'v1.2.3-nightly', null]
    ]) {
      const { run, wrote } = ask(refType, ref);
      if (wanted === null) {
        assert.notEqual(run.status, 0, `${refType} ${ref} is refused`);
        assert.match(run.stdout + run.stderr, /::error::tag .* names no release/,
          `${refType} ${ref} says why`);
        assert.deepEqual(wrote, [],
          `${refType} ${ref} leaves no flag for a later job to read`);
      } else {
        assert.equal(run.status, 0,
          `${refType} ${ref} passes — ${(run.stdout + run.stderr).trim()}`);
        assert.deepEqual(wrote, wanted, `${refType} ${ref} sets ${wanted.join(' ')}`);
        if (wrote.includes('validTag=true')) { released += 1; }
      }
    }
    // Without this a script that refused everything would pass the table above.
    assert.equal(released, 4, `tags this workflow releases from — found ${released}`);
  });
});

// A merged version bump is a release. tag-release.yaml runs when CI passes on
// main, asks tools/tag-plan.sh whether the commit moved the version, tags it and
// starts release.yaml on the tag.
test('a merged version bump is tagged and released', () => {
  const check = (ok, message) => assert.ok(ok, message);
  const tagRelease = fs.readFileSync(shared('.github', 'workflows', 'tag-release.yaml'), 'utf8');
  const planScript = shared('tools', 'tag-plan.sh');

  // tools/tag-plan.sh, run in a throwaway repository.
  const inRepo = (run) => {
    const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cv-plan-'));
    const git = (...args) => {
      const out = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      if (out.status !== 0) { throw new Error('git ' + args.join(' ') + ': ' + out.stderr); }
      return out.stdout.trim();
    };
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'test');
      git('config', 'commit.gpgsign', 'false');
      let n = 0;
      const commit = (manifest) => {
        const at = path.join(repo, 'manifest.json');
        if (manifest === null) { fs.rmSync(at, { force: true }); } else { fs.writeFileSync(at, JSON.stringify(manifest)); }
        n += 1;
        fs.writeFileSync(path.join(repo, 'other.txt'), String(n));
        git('add', '-A');
        git('commit', '-q', '-m', 'c' + n);
        return git('rev-parse', 'HEAD');
      };
      const ask = (sha) => spawnSync('bash', [planScript, sha], { cwd: repo, encoding: 'utf8' });
      run({ commit, ask });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  };
  inRepo(({ commit, ask }) => {
    const out = ask(commit({ version: '1.0.9' }));
    check(out.status === 0 && out.stdout === '', 'a commit with no parent names no tag — ' + out.status + ' ' + out.stdout + out.stderr);
  });
  inRepo(({ commit, ask }) => {
    commit({ version: '1.0.9' });
    const out = ask(commit({ version: '1.0.9' }));
    check(out.status === 0 && out.stdout === '', 'a version that did not move names no tag — ' + out.status + ' ' + out.stdout + out.stderr);
  });
  for (const [shape, before, after, tag] of [
    ['a release', { version: '1.0.9' }, { version: '1.0.10' }, 'v1.0.10'],
    ['a prerelease', { version: '1.0.9' }, { version: '1.0.10', version_name: '1.0.10-rc1' }, 'v1.0.10-rc1'],
    ['the next prerelease', { version: '1.0.10', version_name: '1.0.10-rc1' }, { version: '1.0.10', version_name: '1.0.10-rc2' }, 'v1.0.10-rc2'],
    ['a release after its prerelease', { version: '1.0.10', version_name: '1.0.10-rc1' }, { version: '1.0.10' }, 'v1.0.10']
  ]) {
    inRepo(({ commit, ask }) => {
      commit(before);
      const out = ask(commit(after));
      check(out.status === 0 && out.stdout === tag + '\n', shape + ' prints ' + tag + ' alone — ' + out.status + ' ' + JSON.stringify(out.stdout) + ' ' + out.stderr);
    });
  }
  for (const [shape, after, why] of [
    ['a tag the release path declines', { version: '1.0.10', version_name: '1.0.10-nightly' }, /names no release/],
    ['a version_name not built on the version', { version: '1.0.1', version_name: '1.0.10-rc1' }, /does not begin with version/]
  ]) {
    inRepo(({ commit, ask }) => {
      commit({ version: '1.0.9' });
      const out = ask(commit(after));
      check(out.status !== 0 && out.stdout === '' && why.test(out.stderr), shape + ' is refused with no tag printed — ' + out.status + ' ' + out.stdout + out.stderr);
    });
  }
  inRepo(({ commit, ask }) => {
    commit(null);
    const out = ask(commit({ version: '1.0.10' }));
    check(out.status !== 0 && out.stdout === '' && /cannot read manifest.json/.test(out.stderr),
      'a parent whose manifest cannot be read is refused — ' + out.status + ' ' + out.stdout + out.stderr);
  });
  inRepo(({ commit, ask }) => {
    commit({ version: '1.0.9' });
    const bump = commit({ version: '1.0.10' });
    commit({ version: '1.0.11' });
    check(ask(bump).stdout === 'v1.0.10\n', 'the plan answers for the commit it is given');
    check(ask('HEAD').stdout === 'v1.0.11\n', 'and for HEAD when HEAD is given');
  });

  // The tagging step, run as GitHub runs a bash step, with git, gh and
  // tools/tag-plan.sh replaced by stubs that log what they were asked.
  const HEAD = 'a'.repeat(40);
  const OTHER = 'b'.repeat(40);
  const lines = tagRelease.split('\n');
  const from = lines.findIndex(line => line.trim() === 'run: |');
  check(from > -1, 'tag-release has a script step');
  const stepLines = [];
  for (const line of lines.slice(from + 1)) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(10))) { break; }
    stepLines.push(line.slice(10));
  }
  const step = stepLines.join('\n') + '\n';
  const runStep = ({ plan = '', planStatus = 0, remote = '', releaseRuns = 0 }) => {
    const box = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cv-step-'));
    try {
      const bin = path.join(box, 'bin');
      fs.mkdirSync(path.join(box, 'tools'), { recursive: true });
      fs.mkdirSync(bin);
      const log = path.join(box, 'log').replace(/\\/g, '/');
      fs.writeFileSync(log, '');
      const stub = (name, body) => {
        fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\necho "' + name + ' $*" >> "' + log + '"\n' + body + '\n');
        fs.chmodSync(path.join(bin, name), 0o755);
      };
      stub('git', 'if [[ "$1" == ls-remote ]]; then printf \'%s\' "$STUB_REMOTE"; fi');
      stub('gh', 'if [[ "$1 $2" == "run list" ]]; then echo "$STUB_RUNS"; fi');
      fs.writeFileSync(path.join(box, 'tools', 'tag-plan.sh'),
        'echo "tag-plan $*" >> "' + log + '"\nprintf \'%s\' "$STUB_PLAN"\nexit "$STUB_PLAN_STATUS"\n');
      // Puts the stubs at the front of PATH from inside the script, ahead of
      // anything a bash launcher adds to PATH before the script runs.
      fs.writeFileSync(path.join(box, 'step.sh'), 'export PATH="$(cd "$STUB_BIN" && pwd):$PATH"\n' + step);
      const out = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'step.sh'], {
        cwd: box,
        encoding: 'utf8',
        env: { ...process.env, STUB_BIN: bin.replace(/\\/g, '/'), HEAD_SHA: HEAD, RUNNER_DEBUG: '',
          STUB_PLAN: plan, STUB_PLAN_STATUS: String(planStatus), STUB_REMOTE: remote, STUB_RUNS: String(releaseRuns) }
      });
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
      return { out, calls };
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  };
  const pushes = calls => calls.filter(call => call.startsWith('git push') || call.startsWith('git tag'));
  const dispatches = calls => calls.filter(call => call.startsWith('gh workflow run'));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  {
    const { out, calls } = runStep({ plan: '' });
    check(out.status === 0 && same(calls, ['tag-plan ' + HEAD]), 'no tag planned: nothing is touched — ' + out.status + ' ' + calls.join(' | ') + out.stderr);
  }
  {
    const { out, calls } = runStep({ plan: 'v1.0.10' });
    check(out.status === 0, 'a new tag: the step succeeds — ' + out.stderr);
    check(same(pushes(calls), ['git tag v1.0.10 ' + HEAD, 'git push origin refs/tags/v1.0.10']), 'a new tag is made and pushed — ' + calls.join(' | '));
    check(same(dispatches(calls), ['gh workflow run release.yaml --ref v1.0.10']), 'a new tag starts the release — ' + calls.join(' | '));
    check(calls.findIndex(call => call.startsWith('git ls-remote')) < calls.indexOf('git tag v1.0.10 ' + HEAD), 'the remote is read before the tag is made');
  }
  {
    const { out, calls } = runStep({ plan: 'v1.0.10', remote: OTHER + '\trefs/tags/v1.0.10\n' });
    check(out.status !== 0 && /::error::v1\.0\.10 already names/.test(out.stdout), 'a tag at another commit fails the step — ' + out.status + ' ' + out.stdout);
    check(pushes(calls).length === 0 && dispatches(calls).length === 0, 'and pushes and dispatches nothing — ' + calls.join(' | '));
  }
  for (const [shape, remote] of [
    ['a tag at this commit', HEAD + '\trefs/tags/v1.0.10\n'],
    ['an annotated tag peeling to this commit', OTHER + '\trefs/tags/v1.0.10\n' + HEAD + '\trefs/tags/v1.0.10^{}\n']
  ]) {
    const { out, calls } = runStep({ plan: 'v1.0.10', remote });
    check(out.status === 0 && pushes(calls).length === 0 && same(dispatches(calls), ['gh workflow run release.yaml --ref v1.0.10']),
      shape + ' with no release run: dispatched, not pushed — ' + out.status + ' ' + calls.join(' | ') + out.stderr);
  }
  {
    const { out, calls } = runStep({ plan: 'v1.0.10', remote: HEAD + '\trefs/tags/v1.0.10\n', releaseRuns: 1 });
    check(out.status === 0 && pushes(calls).length === 0 && dispatches(calls).length === 0,
      'a tag the release already ran on is left alone — ' + out.status + ' ' + calls.join(' | '));
  }
  {
    const { out, calls } = runStep({ plan: '', planStatus: 1 });
    check(out.status !== 0 && same(calls, ['tag-plan ' + HEAD]), 'a failed plan fails the step before the remote — ' + out.status + ' ' + calls.join(' | '));
  }
});
