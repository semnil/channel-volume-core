// sync-core.test.cjs — sync-core.sh opens or updates the pull request that
// takes channel-volume-core's main into an extension, and the workflow that
// runs it starts only on its schedule or by hand, from the default branch,
// with the App's token.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const SYNC = path.join(ROOT, 'sync.mjs');
const SCRIPT = path.join(ROOT, 'sync-core.sh');
const WORKFLOW = shared('.github', 'workflows', 'sync-core.yaml');
const BRANCH = 'sync/channel-volume-core';
const BOT = { name: 'sync-app[bot]', email: '1+sync-app[bot]@users.noreply.github.com' };
const SOMEONE = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
function write(dir, file, text, mode) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  if (mode !== undefined) fs.chmodSync(full, mode);
}

// A core whose one shared file is at its first commit, and an extension that
// locks that commit, pushed to a bare origin. gh is a fake that writes its
// arguments to a log and answers `pr list` and `repo view` as the case asks.
function fixture(t, { pr = '', autoMerge = 'true' } = {}) {
  const box = tempDir('cv-sync-core-');
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const core = path.join(box, 'core');
  const origin = path.join(box, 'origin.git');
  const extension = path.join(box, 'extension');
  const log = path.join(box, 'gh.log');
  fs.mkdirSync(core);
  git(core, 'init', '-q', '-b', 'main');
  write(core, 'groups.json', JSON.stringify({ base: ['pack.py'] }));
  write(core, 'sync.mjs', fs.readFileSync(SYNC));
  write(core, 'shared/pack.py', 'print("one")\n');
  git(core, 'add', '-A');
  git(core, ...SOMEONE, 'commit', '-q', '-m', 'one');
  git(box, 'init', '-q', '--bare', '-b', 'main', origin);
  fs.mkdirSync(extension);
  git(extension, 'init', '-q', '-b', 'main');
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'] } }));
  execFileSync(process.execPath, [SYNC, core, extension], { encoding: 'utf8' });
  git(extension, 'add', '-A');
  git(extension, ...SOMEONE, 'commit', '-q', '-m', 'extension');
  git(extension, 'remote', 'add', 'origin', origin);
  git(extension, 'push', '-q', 'origin', 'main');
  write(box, 'bin/gh', [
    '#!/usr/bin/env bash',
    'printf \'%s\\n\' "$*" >> "$GH_LOG"',
    'case "$*" in',
    '  "pr list"*) printf \'%s\' "$GH_PR" ;;',
    '  "repo view --json defaultBranchRef"*) printf \'main\\n\' ;;',
    '  "repo view --json autoMergeAllowed"*) printf \'%s\\n\' "$GH_AUTO_MERGE" ;;',
    'esac',
    ''
  ].join('\n'), 0o755);
  const moveCore = (text) => {
    write(core, 'shared/pack.py', text);
    git(core, ...SOMEONE, 'commit', '-q', '-am', text.trim());
    return git(core, 'rev-parse', 'HEAD');
  };
  // Each run starts on the default branch, as the workflow's checkout leaves
  // it, unless the case says otherwise.
  const run = ({ from = core, on = 'main' } = {}) => {
    git(extension, 'switch', '-q', on);
    return spawnSync('bash', [SCRIPT, from], {
      cwd: extension,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [path.join(box, 'bin'), process.env.PATH].join(path.delimiter),
        GH_LOG: log,
        GH_PR: pr,
        GH_AUTO_MERGE: autoMerge,
        SYNC_GIT_NAME: BOT.name,
        SYNC_GIT_EMAIL: BOT.email
      }
    });
  };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  const pushed = (file) => git(origin, 'show', `${BRANCH}:${file}`);
  // A commit of someone else's on the branch, pushed over what is there.
  const addTheirs = () => {
    git(extension, 'fetch', '-q', 'origin', BRANCH);
    git(extension, 'switch', '-q', '-C', 'theirs', 'FETCH_HEAD');
    write(extension, 'notes.txt', 'a fix of their own\n');
    git(extension, 'add', 'notes.txt');
    git(extension, ...SOMEONE, 'commit', '-q', '-m', 'theirs');
    git(extension, 'push', '-q', '--force', 'origin', `theirs:${BRANCH}`);
    return git(origin, 'rev-parse', BRANCH);
  };
  return { box, core, origin, extension, moveCore, run, calls, pushed, addTheirs };
}

test('sync-core.sh does nothing where core.json locks the core\'s main', (t) => {
  const { core, origin, run, calls } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `core.json already locks ${git(core, 'rev-parse', 'HEAD')}\n`);
  assert.doesNotMatch(calls(), /^pr /m, 'no pull request is touched');
  assert.equal(git(origin, 'branch', '--list', BRANCH), '', 'nothing is pushed');
});

test('sync-core.sh opens the pull request, and turns auto-merge on where the repository allows it', (t) => {
  const { core, origin, moveCore, run, calls, pushed } = fixture(t);
  const before = git(origin, 'rev-parse', 'main');
  const locked = git(core, 'rev-parse', 'HEAD');
  const head = moveCore('print("two")\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(pushed('pack.py'), 'print("two")', 'the branch holds the core\'s main');
  assert.equal(JSON.parse(pushed('core.json')).core.commit, head, 'and locks it');
  assert.equal(git(origin, 'log', '-1', '--format=%an <%ae> %cn <%ce>', BRANCH),
    `${BOT.name} <${BOT.email}> ${BOT.name} <${BOT.email}>`, 'the commit is the App\'s');
  assert.equal(git(origin, 'rev-parse', `${BRANCH}~1`), before, 'on top of the default branch');
  assert.equal(git(origin, 'rev-parse', 'main'), before, 'which is left as it was');
  const log = calls();
  assert.match(log, new RegExp(`^pr create --base main --head ${BRANCH} --title chore: take the shared files from channel-volume-core --body channel-volume-core's main has moved from ${locked} to ${head}: `, 'm'));
  assert.match(log, new RegExp(`^pr merge ${BRANCH} --auto --merge$`, 'm'));
  assert.doesNotMatch(log, /^pr edit /m);
});

test('sync-core.sh updates the open pull request, and leaves auto-merge off where the repository does not allow it', (t) => {
  const { moveCore, run, calls, pushed } = fixture(t, { pr: '7', autoMerge: 'false' });
  const head = moveCore('print("two")\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(pushed('core.json')).core.commit, head);
  const log = calls();
  assert.match(log, new RegExp(`^pr edit ${BRANCH} --body channel-volume-core's main has moved from `, 'm'));
  assert.doesNotMatch(log, /^pr create /m);
  assert.doesNotMatch(log, /^pr merge /m);
});

test('sync-core.sh writes its own branch anew, and leaves one someone else added to', (t) => {
  const { origin, moveCore, run, pushed, addTheirs } = fixture(t);
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  const three = moveCore('print("three")\n');
  const again = run();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(pushed('pack.py'), 'print("three")', 'a later run replaces the branch it wrote');
  assert.equal(JSON.parse(pushed('core.json')).core.commit, three);

  const theirs = addTheirs();
  moveCore('print("four")\n');
  const refused = run();
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `${BRANCH} ends in a commit by t@example.invalid; it is left as it is\n`);
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'their commit stays at the head');
});

test('sync-core.sh runs from the default branch only', (t) => {
  const { origin, extension, moveCore, run } = fixture(t);
  git(extension, 'switch', '-q', '-c', 'feature');
  write(extension, 'feature.txt', 'not done yet\n');
  git(extension, 'add', 'feature.txt');
  git(extension, ...SOMEONE, 'commit', '-q', '-m', 'feature');
  moveCore('print("two")\n');
  const refused = run({ on: 'feature' });
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, 'run from feature, not the default branch main\n');
  assert.equal(git(origin, 'branch', '--list', BRANCH), '', 'nothing is pushed');
});

test('sync-core.sh works from a core cloned the way the workflow clones it', (t) => {
  const { box, core, moveCore, run, pushed } = fixture(t);
  const head = moveCore('print("two")\n');
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const clone = workflow.match(/^ {8}run: git clone (.*) https:\/\/github\.com\/semnil\/channel-volume-core "\$RUNNER_TEMP\/core"$/m);
  assert.ok(clone, 'the workflow clones channel-volume-core');
  const cloned = path.join(box, 'cloned-core');
  execFileSync('git', ['clone', ...clone[1].split(' '), `file://${core}`, cloned]);
  const result = run({ from: cloned });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(pushed('core.json')).core.commit, head);
});

test('the sync workflow runs on its schedule or by hand, from the default branch, with the App\'s token, where the App is set up', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:\n') + 5, workflow.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+(?=:)/gm).map((key) => key.trim()), ['schedule', 'workflow_dispatch'],
    'nothing a pull request or a push can start');
  assert.match(workflow, /^ {4}if: vars\.SYNC_APP_CLIENT_ID != ''$/m, 'the job is skipped where the App is not set up');
  assert.match(workflow, /^ {6}- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n {10}token: \$\{\{ steps\.app\.outputs\.token \}\}$/m,
    'the checkout takes the default branch, and pushes with the App\'s token');
  assert.match(workflow, /^ {10}GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}$/m, 'and gh opens the pull request with it');
  assert.match(workflow, /^ {10}bash "\$RUNNER_TEMP\/core\/sync-core\.sh" "\$RUNNER_TEMP\/core"$/m,
    'the script runs from the clone of the core, which the sync does not write');
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|github\.token/, 'the workflow\'s own token, whose pull requests start no checks, is not used');
});
