// sync-core.test.cjs — sync-core.sh opens, updates or closes the pull request
// that takes channel-volume-core's main into an extension, and the workflow that
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
// The run's own open pull request, and a fork's from a branch of the same name.
const OURS = { number: 7, isCrossRepository: false };
const FORKS = { number: 9, isCrossRepository: true };
// The URL the fake gh pr create prints for the pull request it opens.
const CREATED = 'https://github.com/semnil/extension/pull/8';
const GIT = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
function write(dir, file, text, mode) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  if (mode !== undefined) fs.chmodSync(full, mode);
}

// A core whose one shared file is at its first commit, and an extension that
// locks that commit, pushed to a bare origin. gh is a fake that writes its
// arguments to a log and answers the calls the script makes as the case asks:
// pr list runs the call's --jq filter, with jq, on the open pull requests the
// case gives. It knows only the calls the real gh 2.103 takes, with the fields
// it has: any other call exits 1, as the real gh does for an unknown --json
// field.
function fixture(t, { prs = [], autoMerge = 'true', listFails = false } = {}) {
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
    '  "repo view --json defaultBranchRef --jq .defaultBranchRef.name") printf \'main\\n\' ;;',
    '  "api repos/{owner}/{repo} --jq .allow_auto_merge") printf \'%s\\n\' "$GH_AUTO_MERGE" ;;',
    '  "pr list --head sync/channel-volume-core --base main --state open --json number,isCrossRepository --jq .[] | select(.isCrossRepository | not) | .number")',
    '    if [ -n "$GH_LIST_FAILS" ]; then exit 1; fi',
    '    printf \'%s\' "$GH_PRS" | jq -r "${@: -1}" ;;',
    '  "pr create --base main --head sync/channel-volume-core "*) printf \'%s\\n\' "$GH_CREATED" ;;',
    '  "pr edit 7 --body "*|"pr merge 7 --auto --merge"|"pr merge $GH_CREATED --auto --merge") ;;',
    '  "pr comment 7 --body "*|"pr close 7") ;;',
    '  *) printf \'gh: not a call the real gh takes here: %s\\n\' "$*" >&2; exit 1 ;;',
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
  const run = ({ from = core, on = 'main', bin = [] } = {}) => {
    git(extension, 'switch', '-q', on);
    return spawnSync('bash', [SCRIPT, from], {
      cwd: extension,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [...bin, path.join(box, 'bin'), process.env.PATH].join(path.delimiter),
        GH_LOG: log,
        GH_PRS: JSON.stringify(prs),
        GH_CREATED: CREATED,
        GH_AUTO_MERGE: autoMerge,
        GH_LIST_FAILS: listFails ? '1' : '',
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
  assert.doesNotMatch(calls(), /^pr (create|edit|merge|close) /m, 'no pull request is touched');
  assert.equal(git(origin, 'branch', '--list', BRANCH), '', 'nothing is pushed');
});

// The default branch takes the core's main by another way than the sync's
// pull request: the extension syncs it by hand and pushes it to main.
function takeByHand({ core, extension }) {
  git(extension, 'switch', '-q', 'main');
  execFileSync(process.execPath, [SYNC, core, extension], { encoding: 'utf8' });
  git(extension, 'add', '-A');
  git(extension, ...SOMEONE, 'commit', '-q', '-m', 'by hand');
  git(extension, 'push', '-q', 'origin', 'main');
}

test('sync-core.sh closes its pull request once the default branch locks the core\'s main by another way', (t) => {
  const box = fixture(t, { prs: [FORKS, OURS] });
  const { origin, moveCore, run, calls } = box;
  const head = moveCore('print("two")\n');
  assert.equal(run().status, 0);
  takeByHand(box);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `core.json already locks ${head}\nclosed the pull request from ${BRANCH}\n`);
  assert.match(calls(), new RegExp(`^pr comment 7 --body core\\.json on main already locks ${head}, channel-volume-core's main, so this pull request has nothing left to take\\.$`, 'm'));
  assert.match(calls(), /^pr close 7$/m, 'its own, not the fork\'s');
  assert.equal(git(origin, 'branch', '--list', BRANCH), '', 'and its branch is deleted');
});

test('sync-core.sh leaves open a fulfilled pull request someone else added to', (t) => {
  const box = fixture(t, { prs: [OURS] });
  const { origin, moveCore, run, calls, addTheirs } = box;
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  const theirs = addTheirs();
  takeByHand(box);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`the pull request from ${BRANCH} ends in a commit by t@example\\.invalid, committed by t@example\\.invalid; it is left open\n$`));
  assert.doesNotMatch(calls(), /^pr (comment|close) /m);
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'their branch stays');
});

test('sync-core.sh closes a fulfilled pull request whose branch is already gone', (t) => {
  const box = fixture(t, { prs: [OURS] });
  const { moveCore, run, calls } = box;
  moveCore('print("two")\n');
  takeByHand(box);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls(), /^pr comment 7 /m);
  assert.match(calls(), /^pr close 7$/m);
});

test('sync-core.sh leaves a fulfilled pull request open where its branch cannot be deleted', (t) => {
  const box = fixture(t, { prs: [OURS] });
  const { origin, moveCore, run, calls } = box;
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  const ours = git(origin, 'rev-parse', BRANCH);
  takeByHand(box);
  write(origin, 'hooks/pre-receive', '#!/usr/bin/env bash\necho refused >&2\nexit 1\n', 0o755);
  const refused = run();
  assert.notEqual(refused.status, 0, 'the deletion is refused');
  assert.doesNotMatch(calls(), /^pr (comment|close) /m, 'the pull request is not touched');
  assert.equal(git(origin, 'rev-parse', BRANCH), ours, 'the branch stays');
});

test('sync-core.sh leaves a fulfilled pull request open where a commit reaches its branch after the run reads it', (t) => {
  const box = fixture(t, { prs: [OURS] });
  const { box: dir, origin, extension, moveCore, run, calls } = box;
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  git(extension, 'fetch', '-q', 'origin', BRANCH);
  git(extension, 'switch', '-q', '-C', 'theirs', 'FETCH_HEAD');
  write(extension, 'notes.txt', 'a fix of their own\n');
  git(extension, 'add', 'notes.txt');
  git(extension, ...SOMEONE, 'commit', '-q', '-m', 'theirs');
  const theirs = git(extension, 'rev-parse', 'HEAD');
  takeByHand(box);
  // Their commit reaches origin from a git that pushes it ahead of the run's
  // first push: after the run has read the branch, before the deletion.
  const mark = path.join(dir, 'pushed-theirs');
  write(dir, 'racing/git', [
    '#!/usr/bin/env bash',
    `if [ "$1" = push ] && [ ! -e ${JSON.stringify(mark)} ]; then`,
    `  : > ${JSON.stringify(mark)}`,
    `  ${JSON.stringify(GIT)} push -q origin theirs:refs/heads/${BRANCH} || exit 1`,
    'fi',
    `exec ${JSON.stringify(GIT)} "$@"`,
    ''
  ].join('\n'), 0o755);
  const refused = run({ bin: [path.join(dir, 'racing')] });
  assert.ok(fs.existsSync(mark), 'their commit was pushed during the run');
  assert.notEqual(refused.status, 0, 'the deletion is refused');
  assert.doesNotMatch(calls(), /^pr (comment|close) /m, 'the pull request is not touched');
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'their commit stays at the head');
});

test('sync-core.sh leaves alone a fork\'s pull request from a branch of the same name', (t) => {
  const box = fixture(t, { prs: [FORKS] });
  const { moveCore, run, calls } = box;
  const head = moveCore('print("two")\n');
  const opened = run();
  assert.equal(opened.status, 0, opened.stderr);
  assert.match(calls(), /^pr create /m, 'the run opens its own pull request');
  assert.doesNotMatch(calls(), /^pr edit /m, 'rather than updating the fork\'s');
  takeByHand(box);
  const fulfilled = run();
  assert.equal(fulfilled.status, 0, fulfilled.stderr);
  assert.equal(fulfilled.stdout, `core.json already locks ${head}\n`);
  assert.doesNotMatch(calls(), /^pr (comment|close) /m, 'nor closes it');
});

test('sync-core.sh stops where it cannot read the branch of a fulfilled pull request', (t) => {
  const box = fixture(t, { prs: [OURS] });
  const { box: dir, origin, moveCore, run, calls } = box;
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  const ours = git(origin, 'rev-parse', BRANCH);
  takeByHand(box);
  write(dir, 'broken/git', `#!/usr/bin/env bash\nif [ "$1" = ls-remote ]; then exit 128; fi\nexec ${JSON.stringify(GIT)} "$@"\n`, 0o755);
  const refused = run({ bin: [path.join(dir, 'broken')] });
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `origin's ${BRANCH} could not be read (git ls-remote exit 128)\n`);
  assert.doesNotMatch(calls(), /^pr (comment|close) /m);
  assert.equal(git(origin, 'rev-parse', BRANCH), ours, 'the branch stays');
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
  assert.match(log, new RegExp(`^pr merge ${CREATED} --auto --merge$`, 'm'), 'the pull request just opened, by its URL');
  assert.doesNotMatch(log, /^pr edit /m);
});

test('sync-core.sh updates the open pull request, and leaves auto-merge off where the repository does not allow it', (t) => {
  const { moveCore, run, calls, pushed } = fixture(t, { prs: [OURS], autoMerge: 'false' });
  const head = moveCore('print("two")\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(pushed('core.json')).core.commit, head);
  const log = calls();
  assert.match(log, new RegExp(`^pr edit 7 --body channel-volume-core's main has moved from `, 'm'));
  assert.doesNotMatch(log, /^pr create /m);
  assert.doesNotMatch(log, /^pr merge /m);
});

test('sync-core.sh updates the open pull request and turns auto-merge on for it by its number', (t) => {
  const { moveCore, run, calls } = fixture(t, { prs: [OURS] });
  moveCore('print("two")\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls(), /^pr edit 7 --body /m);
  assert.match(calls(), /^pr merge 7 --auto --merge$/m);
});

test('sync-core.sh stops before it pushes where the auto-merge setting cannot be read', (t) => {
  const { origin, moveCore, run, calls } = fixture(t, { autoMerge: '' });
  moveCore('print("two")\n');
  const refused = run();
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, "the repository's auto-merge setting could not be read (got '')\n");
  assert.equal(git(origin, 'branch', '--list', BRANCH), '', 'nothing is pushed');
  assert.doesNotMatch(calls(), /^pr /m);
});

test('sync-core.sh stops where the open pull requests cannot be listed', (t) => {
  const { moveCore, run, calls } = fixture(t, { listFails: true });
  moveCore('print("two")\n');
  const refused = run();
  assert.notEqual(refused.status, 0);
  assert.doesNotMatch(calls(), /^pr (create|edit|merge) /m, 'no pull request is opened, edited or merged');
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
  assert.equal(refused.stderr, `${BRANCH} ends in a commit by t@example.invalid, committed by t@example.invalid; it is left as it is\n`);
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'their commit stays at the head');
});

test('sync-core.sh leaves a commit of the App\'s that someone else amended', (t) => {
  const { origin, extension, moveCore, run } = fixture(t);
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  git(extension, 'fetch', '-q', 'origin', BRANCH);
  git(extension, 'switch', '-q', '-C', 'amended', 'FETCH_HEAD');
  write(extension, 'notes.txt', 'folded into the App\'s commit\n');
  git(extension, 'add', 'notes.txt');
  git(extension, ...SOMEONE, 'commit', '-q', '--amend', '--no-edit');
  git(extension, 'push', '-q', '--force', 'origin', `amended:${BRANCH}`);
  const amended = git(origin, 'rev-parse', BRANCH);
  moveCore('print("three")\n');
  const refused = run();
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `${BRANCH} ends in a commit by ${BOT.email}, committed by t@example.invalid; it is left as it is\n`);
  assert.equal(git(origin, 'rev-parse', BRANCH), amended);
});

test('sync-core.sh does not push over a commit that reaches the branch while it runs', (t) => {
  const { box, core, origin, moveCore, run, addTheirs } = fixture(t);
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  // Someone's commit, made now and pushed by the sync step of the next run,
  // after the run has read the branch.
  const theirs = addTheirs();
  const bots = git(origin, 'rev-parse', `${BRANCH}~1`);
  git(origin, 'update-ref', `refs/heads/${BRANCH}`, bots);
  write(core, 'sync-real.mjs', fs.readFileSync(SYNC));
  write(core, 'sync.mjs', [
    "import { execFileSync } from 'node:child_process';",
    `execFileSync('git', ['-C', ${JSON.stringify(origin)}, 'update-ref', 'refs/heads/${BRANCH}', ${JSON.stringify(theirs)}]);`,
    "await import('./sync-real.mjs');",
    ''
  ].join('\n'));
  moveCore('print("three")\n');
  const result = run();
  assert.notEqual(result.status, 0, 'the push is refused');
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'their commit stays at the head');
});

test('sync-core.sh stops where it cannot read the branch', (t) => {
  const { box, origin, moveCore, run, calls, addTheirs } = fixture(t);
  moveCore('print("two")\n');
  assert.equal(run().status, 0);
  const theirs = addTheirs();
  write(box, 'broken/git', `#!/usr/bin/env bash\nif [ "$1" = ls-remote ]; then exit 128; fi\nexec ${JSON.stringify(GIT)} "$@"\n`, 0o755);
  moveCore('print("three")\n');
  const before = calls();
  const refused = run({ bin: [path.join(box, 'broken')] });
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `origin's ${BRANCH} could not be read (git ls-remote exit 128)\n`);
  assert.equal(git(origin, 'rev-parse', BRANCH), theirs, 'what is there stays');
  assert.doesNotMatch(calls().slice(before.length), /^pr /m);
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

test('the sync workflow runs on its schedule or by hand, one run at a time, from the default branch, with the App\'s token, where the App is set up', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:\n') + 5, workflow.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+(?=:)/gm).map((key) => key.trim()), ['schedule', 'workflow_dispatch'],
    'nothing a pull request or a push can start');
  assert.match(workflow, /^ {4}if: vars\.SYNC_APP_CLIENT_ID != ''$/m, 'the job is skipped where the App is not set up');
  assert.match(workflow, /^concurrency:\n {2}group: sync-core\n {2}cancel-in-progress: false$/m,
    'one run at a time, in one group whatever branch started it, and a waiting run is not cancelled');
  assert.match(workflow, /^ {6}- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n {10}token: \$\{\{ steps\.app\.outputs\.token \}\}$/m,
    'the checkout takes the default branch, and pushes with the App\'s token');
  assert.match(workflow, /^ {10}GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}$/m, 'and gh opens the pull request with it');
  assert.match(workflow, /^ {10}bash "\$RUNNER_TEMP\/core\/sync-core\.sh" "\$RUNNER_TEMP\/core"$/m,
    'the script runs from the clone of the core, which the sync does not write');
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|github\.token/, 'the workflow\'s own token, whose pull requests start no checks, is not used');
});
