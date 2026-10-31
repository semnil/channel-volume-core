// sync.test.mjs — sync.mjs copies a commit's shared files into an extension
// and finds every way a copy can stop being that commit's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SYNC = path.join(ROOT, 'sync.mjs');
const BIT_HELD = process.platform !== 'win32';

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function write(dir, file, text, mode) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  if (mode !== undefined) fs.chmodSync(full, mode);
}

// A core repository with two groups, committed, and an extension that takes
// the first group only.
function fixture(t) {
  const box = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cv-sync-'));
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const core = path.join(box, 'core');
  const extension = path.join(box, 'extension');
  fs.mkdirSync(core);
  fs.mkdirSync(extension);
  git(core, 'init', '-q', '-b', 'main');
  write(core, 'groups.json', JSON.stringify({
    base: ['pack.py', 'tools/run.sh'],
    extra: ['.github/extra.yml']
  }));
  write(core, 'shared/pack.py', 'print("pack")\n');
  write(core, 'shared/tools/run.sh', '#!/bin/sh\necho run\n', 0o755);
  write(core, 'shared/.github/extra.yml', 'extra: true\n');
  git(core, 'add', '-A');
  git(core, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'] }, package: 'x-y' }, null, 2) + '\n');
  return { core, extension, commit: git(core, 'rev-parse', 'HEAD') };
}

function run(...args) {
  return spawnSync(process.execPath, [SYNC, ...args], { encoding: 'utf8' });
}

test('sync copies the groups the extension names and locks the commit', (t) => {
  const { core, extension, commit } = fixture(t);
  const result = run(core, extension);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(extension, 'pack.py'), 'utf8'), 'print("pack")\n');
  assert.equal(fs.readFileSync(path.join(extension, 'tools/run.sh'), 'utf8'), '#!/bin/sh\necho run\n');
  assert.equal(fs.existsSync(path.join(extension, '.github/extra.yml')), false, 'a group it does not name stays out');
  if (BIT_HELD) {
    assert.notEqual(fs.statSync(path.join(extension, 'tools/run.sh')).mode & 0o111, 0, 'an executable stays one');
    assert.equal(fs.statSync(path.join(extension, 'pack.py')).mode & 0o111, 0);
  }
  const config = JSON.parse(fs.readFileSync(path.join(extension, 'core.json'), 'utf8'));
  assert.deepEqual(config, { core: { groups: ['base'], commit }, package: 'x-y' });
});

test('sync copies what the commit holds, not what the working tree holds', (t) => {
  const { core, extension } = fixture(t);
  write(core, 'shared/pack.py', 'print("uncommitted")\n');
  assert.equal(run(core, extension).status, 0);
  assert.equal(fs.readFileSync(path.join(extension, 'pack.py'), 'utf8'), 'print("pack")\n');
});

test('check passes a copy made by sync', (t) => {
  const { core, extension, commit } = fixture(t);
  run(core, extension);
  const result = run('--check', core, extension);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`2 shared files are as ${commit} has them`));
});

test('check names a copy edited after the sync', (t) => {
  const { core, extension } = fixture(t);
  run(core, extension);
  fs.appendFileSync(path.join(extension, 'pack.py'), '# edited\n');
  const result = run('--check', core, extension);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pack\.py: differs from [0-9a-f]{40}/);
});

test('check names a missing copy', (t) => {
  const { core, extension } = fixture(t);
  run(core, extension);
  fs.rmSync(path.join(extension, 'tools/run.sh'));
  const result = run('--check', core, extension);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tools\/run\.sh: missing/);
});

test('check names a copy whose executable bit moved', { skip: !BIT_HELD && 'no executable bit here' }, (t) => {
  const { core, extension } = fixture(t);
  run(core, extension);
  fs.chmodSync(path.join(extension, 'tools/run.sh'), 0o644);
  fs.chmodSync(path.join(extension, 'pack.py'), 0o755);
  const result = run('--check', core, extension);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tools\/run\.sh: not executable/);
  assert.match(result.stderr, /pack\.py: executable/);
});

test('check compares with the locked commit, not with a later one', (t) => {
  const { core, extension } = fixture(t);
  run(core, extension);
  write(core, 'shared/pack.py', 'print("later")\n');
  git(core, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-am', 'two');
  assert.equal(run('--check', core, extension).status, 0, 'the copy is still the locked commit');
  run(core, extension);
  assert.equal(fs.readFileSync(path.join(extension, 'pack.py'), 'utf8'), 'print("later")\n');
  assert.equal(run('--check', core, extension).status, 0);
});

test('check refuses a lock that names no commit', (t) => {
  const { core, extension } = fixture(t);
  for (const commit of [undefined, 'main', 'A'.repeat(40)]) {
    write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'], commit } }));
    const result = run('--check', core, extension);
    assert.equal(result.status, 1, String(commit));
    assert.match(result.stderr, /core\.json locks no commit/);
  }
});

test('sync and check refuse a group the commit does not have, and a config with none', (t) => {
  const { core, extension } = fixture(t);
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['nope'] } }));
  let result = run(core, extension);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no group named nope/);
  const configs = [null, 'core', {}, { core: null }, { core: 'base' }, { core: {} }, { core: { groups: [] } },
    { core: { groups: [1] } }, { core: { groups: ['base', 1] } }];
  for (const config of configs) {
    write(extension, 'core.json', JSON.stringify(config));
    result = run(core, extension);
    assert.equal(result.status, 1, JSON.stringify(config));
    assert.match(result.stderr, /core\.json (has no "core" object|names no groups)/);
  }
});

test('a wrong argument list prints the usage', () => {
  for (const args of [[], ['one'], ['--check', 'one'], ['-x', 'two']]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /^usage: /);
  }
});

// A later commit of the fixture core, with groups.json and shared/ as given.
function recommit(core, groups, writes = {}, removes = []) {
  write(core, 'groups.json', JSON.stringify(groups));
  for (const [file, text] of Object.entries(writes)) write(core, `shared/${file}`, text);
  for (const file of removes) fs.rmSync(path.join(core, 'shared', file));
  git(core, 'add', '-A');
  git(core, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'later');
  return git(core, 'rev-parse', 'HEAD');
}

test('sync refuses, and writes nothing, where a file the last commit shared is still here unshared', (t) => {
  for (const [why, setUp, named] of [
    ['dropped', (core) => recommit(core, { base: ['pack.py'], extra: ['.github/extra.yml'] }, {}, ['tools/run.sh']), 'tools/run.sh'],
    ['renamed', (core) => recommit(core, { base: ['pack.py', 'tools/go.sh'], extra: ['.github/extra.yml'] },
      { 'tools/go.sh': '#!/bin/sh\necho run\n' }, ['tools/run.sh']), 'tools/run.sh'],
    ['in a group no longer taken', (core, extension) => {
      write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'], commit: lockOf(extension) } }));
    }, '.github/extra.yml']
  ]) {
    const { core, extension, commit } = fixture(t);
    write(extension, 'core.json', JSON.stringify({ core: { groups: ['base', 'extra'] } }));
    assert.equal(run(core, extension).status, 0, why);
    setUp(core, extension);
    const before = fs.readFileSync(path.join(extension, 'core.json'), 'utf8');
    const result = run(core, extension);
    assert.equal(result.status, 1, `${why}: ${result.stderr}`);
    assert.ok(result.stderr.includes(`no longer gives this extension what ${commit} shared, and it is still here:\n  ${named}\n`),
      `${why}: ${result.stderr}`);
    assert.equal(fs.readFileSync(path.join(extension, 'core.json'), 'utf8'), before, `${why}: the lock does not move`);
    assert.equal(result.stdout, '', `${why}: nothing is written`);

    fs.rmSync(path.join(extension, named));
    const again = run(core, extension);
    assert.equal(again.status, 0, `${why}: with it removed the sync goes ahead — ${again.stderr}`);
  }
});

function lockOf(extension) {
  return JSON.parse(fs.readFileSync(path.join(extension, 'core.json'), 'utf8')).core.commit;
}

test('a copy that differs from the commit that shared it is the extension\'s own and is left alone', (t) => {
  const { core, extension } = fixture(t);
  run(core, extension);
  write(extension, 'tools/run.sh', '#!/bin/sh\necho mine\n');
  write(extension, 'own.txt', 'never shared\n');
  const later = recommit(core, { base: ['pack.py'], extra: ['.github/extra.yml'] }, {}, ['tools/run.sh']);
  const result = run(core, extension);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(extension, 'tools/run.sh'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(fs.readFileSync(path.join(extension, 'own.txt'), 'utf8'), 'never shared\n');
  assert.equal(lockOf(extension), later);
  // A group the extension never took is nothing it holds.
  assert.equal(fs.existsSync(path.join(extension, '.github/extra.yml')), false);
});

test('sync replaces a lock that names no commit, with nothing to compare it against', (t) => {
  const { core, extension, commit } = fixture(t);
  for (const lock of ['nope', 'a'.repeat(39)]) {
    write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'], commit: lock } }));
    const result = run(core, extension);
    assert.equal(result.status, 0, `${lock}: ${result.stderr}`);
    assert.equal(lockOf(extension), commit);
  }
});

test('sync refuses a locked commit the core it copies from does not have', (t) => {
  const { core, extension } = fixture(t);
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'], commit: 'a'.repeat(40) } }));
  const result = run(core, extension);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`${'a'.repeat(40)}, the commit core\\.json locks, is not in `));
  assert.equal(fs.existsSync(path.join(extension, 'pack.py')), false, 'and writes nothing');
});

// A repository whose core.filemode is false keeps the executable bit in its
// index alone, as git does on Windows: the sync sets it there, a commit made
// from it carries it, and a check in that repository reads it from there.
test('where git keeps the executable bit in its index, sync sets it there and check reads it there', (t) => {
  const { core, extension } = fixture(t);
  git(extension, 'init', '-q', '-b', 'main');
  git(extension, 'config', 'core.filemode', 'false');
  assert.equal(run(core, extension).status, 0);
  const staged = (file) => git(extension, 'ls-files', '--stage', '--', file).split(/\s/)[0];
  assert.equal(staged('tools/run.sh'), '100755');
  assert.equal(staged('pack.py'), '100644');
  git(extension, 'add', 'core.json');
  git(extension, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'sync');
  const fresh = path.join(path.dirname(extension), 'fresh');
  git(path.dirname(extension), 'clone', '-q', extension, fresh);
  assert.equal(run('--check', core, fresh).status, 0, 'a fresh checkout of the commit passes the check');

  if (BIT_HELD) {
    // The bit on disk is not what the check reads here.
    fs.chmodSync(path.join(extension, 'tools/run.sh'), 0o644);
    assert.equal(run('--check', core, extension).status, 0);
  }
  git(extension, 'update-index', '--chmod=-x', 'tools/run.sh');
  const unset = run('--check', core, extension);
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /tools\/run\.sh: not executable/);
  git(extension, 'update-index', '--chmod=+x', 'tools/run.sh', 'pack.py');
  assert.match(run('--check', core, extension).stderr, /pack\.py: executable/);
  git(extension, 'rm', '-q', '--cached', 'pack.py');
  assert.match(run('--check', core, extension).stderr, /pack\.py: not in git's index/);
});

test('where git keeps the executable bit in its index, a file already there keeps what is staged for it', (t) => {
  const { core, extension } = fixture(t);
  git(extension, 'init', '-q', '-b', 'main');
  git(extension, 'config', 'core.filemode', 'false');
  run(core, extension);
  git(extension, 'add', 'core.json');
  git(extension, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'sync');
  write(extension, 'tools/run.sh', '#!/bin/sh\necho staged\n');
  git(extension, 'update-index', '--chmod=-x', 'tools/run.sh');
  git(extension, 'add', 'tools/run.sh');
  git(extension, 'update-index', '--chmod=-x', 'tools/run.sh');
  assert.equal(run(core, extension).status, 0);
  assert.equal(git(extension, 'show', ':tools/run.sh'), '#!/bin/sh\necho staged', 'what was staged stays staged');
  assert.equal(git(extension, 'ls-files', '--stage', '--', 'tools/run.sh').split(/\s/)[0], '100755', 'and the bit is set');
  assert.equal(fs.readFileSync(path.join(extension, 'tools/run.sh'), 'utf8'), '#!/bin/sh\necho run\n');
});

// check-shared.sh fetches the locked commit and runs that commit's check. The
// fixture core carries this repository's sync.mjs and check-shared.sh, and
// answers a fetch for any commit it holds, as GitHub does.
function fetchedFixture(t) {
  const box = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cv-check-'));
  t.after(() => fs.rmSync(box, { recursive: true, force: true }));
  const core = path.join(box, 'core');
  const extension = path.join(box, 'extension');
  fs.mkdirSync(core);
  fs.mkdirSync(extension);
  git(core, 'init', '-q', '-b', 'main');
  git(core, 'config', 'uploadpack.allowReachableSHA1InWant', 'true');
  write(core, 'groups.json', JSON.stringify({ base: ['pack.py', 'tools/check-shared.sh'] }));
  write(core, 'sync.mjs', fs.readFileSync(SYNC));
  write(core, 'shared/pack.py', 'print("pack")\n');
  write(core, 'shared/tools/check-shared.sh', fs.readFileSync(path.join(ROOT, 'shared/tools/check-shared.sh')), 0o755);
  git(core, 'add', '-A');
  git(core, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'one');
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'] } }));
  assert.equal(run(core, extension).status, 0);
  const check = () => spawnSync('bash', ['tools/check-shared.sh'], {
    cwd: extension, encoding: 'utf8', env: { ...process.env, CORE_SOURCE: core }
  });
  return { core, extension, check };
}

test('check-shared.sh passes copies the locked commit holds', (t) => {
  const { check } = fetchedFixture(t);
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 shared files are as [0-9a-f]{40} has them/);
});

test('check-shared.sh fails a copy edited after the sync', (t) => {
  const { extension, check } = fetchedFixture(t);
  fs.appendFileSync(path.join(extension, 'pack.py'), '# edited\n');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pack\.py: differs from/);
});

test('check-shared.sh holds the copies to the locked commit after the core moves on', (t) => {
  const { core, extension, check } = fetchedFixture(t);
  write(core, 'shared/pack.py', 'print("later")\n');
  git(core, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-am', 'two');
  assert.equal(check().status, 0, 'the copies are the locked commit\'s');
  fs.writeFileSync(path.join(extension, 'pack.py'), 'print("later")\n');
  assert.equal(check().status, 1, 'a later commit\'s copy is not the locked one');
});

test('check-shared.sh refuses a lock that names no commit', (t) => {
  const { extension, check } = fetchedFixture(t);
  write(extension, 'core.json', JSON.stringify({ core: { groups: ['base'], commit: 'main' } }));
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /core\.json locks no commit: main/);
});

// The groups name every shared file once, and only shared files. The one
// file under shared/ no group carries is this repository's own record of the
// mutants its tests let through, which sweep.mjs reads from beside itself.
const NOT_SHARED = ['tools/mutation/equivalents.md'];
test('groups.json and shared/ list the same files', () => {
  const groups = JSON.parse(fs.readFileSync(path.join(ROOT, 'groups.json'), 'utf8'));
  const listed = Object.values(groups).flat();
  assert.equal(new Set(listed).size, listed.length, 'a file sits in two groups');
  const held = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, 'shared', dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(relative);
      else held.push(relative);
    }
  };
  walk('');
  assert.deepEqual([...listed].sort(), held.filter((file) => !NOT_SHARED.includes(file)).sort());
});
