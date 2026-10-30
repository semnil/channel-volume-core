// helpers.cjs — What the tests of the shared tools have in common: where the
// tools are, a directory of its own for each case, and the readers that look
// inside what pack.py writes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Python children write their output in UTF-8, the encoding every read below
// decodes it with, whatever code page the host gives a pipe.
process.env.PYTHONIOENCODING = 'utf-8';

const ROOT = path.join(__dirname, '..');

// A shared file, at the path it has inside an extension.
function shared(...parts) {
  return path.join(ROOT, 'shared', ...parts);
}

// The package a fixture's core.json names, and the zip pack.py writes for it.
const PACKAGE = 'cv-fixture';
const zipName = (version) => `${PACKAGE}-${version}.zip`;

// core.json beside the copy of a tool, as an extension carries it.
function writeCore(dir, config = { package: PACKAGE }) {
  fs.writeFileSync(path.join(dir, 'core.json'), JSON.stringify(config, null, 2) + '\n');
}

// A directory under the OS temp dir, named after the case.
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

function withFixtureDir(prefix, body) {
  const dir = tempDir(prefix);
  try {
    body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!fs.existsSync(dir), `${dir} was left behind`);
}

// Why a case that makes a symbolic link does not run here, or false where it runs.
const SYMLINK_SKIP = process.platform === 'win32'
  && 'symlinks need a privilege this does not ask for';

// What the archive holds, by name and by the digest of its bytes. Reading the
// bytes is the point: namelist() alone answers for the names only.
function heldInZip(dir, archive) {
  const read = spawnSync('python3', ['-c',
    'import hashlib, sys, zipfile\n'
    + 'held = zipfile.ZipFile(sys.argv[1])\n'
    + 'for name in held.namelist():\n'
    + '    print(name, hashlib.sha256(held.read(name)).hexdigest())',
    archive], { cwd: dir, encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  return read.stdout.trim().split(/\r?\n/).filter(Boolean)
    .map((line) => line.split(' '));
}

const WINDOWS_PATH_HARNESS = [
    'import ntpath, os, builtins, types, importlib.util',
    'spec = importlib.util.spec_from_file_location("packmod", "pack.py")',
    'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'real, real_open, real_os = os.path, builtins.open, os',
    'host = lambda p: p.replace(chr(92), "/")',
    'win = lambda p: p.replace("/", chr(92))',
    'class W:',
    '    isabs, normpath, join, dirname = ntpath.isabs, ntpath.normpath, ntpath.join, ntpath.dirname',
    '    realpath = staticmethod(lambda p: win(real.realpath(host(p))))',
    '    isfile = staticmethod(lambda p: real.isfile(host(p)))',
    '    isdir = staticmethod(lambda p: real.isdir(host(p)))',
    '    abspath = staticmethod(lambda p: win(real.abspath(host(p))))',
    'mod.os = types.SimpleNamespace(path=W, listdir=lambda p: real_os.listdir(host(p)),',
    '                               remove=real_os.remove, sep=chr(92))',
    'mod.open = lambda p, *a, **k: real_open(host(p), *a, **k)',
    'print(chr(10).join(arc for _f, arc in mod.selected_files(win(real.abspath(".")))))'
].join('\n');

// The names pack.py selects in `cwd` under Windows path semantics, or null
// where python3 cannot be started.
function namesOnWindows(cwd, where) {
  const run = spawnSync('python3', ['-B', '-c', WINDOWS_PATH_HARNESS],
    { cwd, encoding: 'utf8' });
  if (run.error) {
    console.log(`  (windows path check skipped for ${where}: ${run.error.message})`);
    return null;
  }
  assert.equal(run.status, 0,
    `the windows path harness runs on ${where} — ${(run.stderr || '').trim()}`);
  const names = (run.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const backslashed = names.filter((name) => name.includes('\\'));
  assert.deepEqual(backslashed, [],
    `every name inside ${where}'s package stays POSIX on Windows`);
  return names;
}

module.exports = {
  ROOT,
  shared,
  PACKAGE,
  zipName,
  writeCore,
  tempDir,
  withFixtureDir,
  SYMLINK_SKIP,
  heldInZip,
  namesOnWindows
};
