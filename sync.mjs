#!/usr/bin/env node
// sync.mjs — copies the shared files into an extension, or checks that an
// extension holds them as a commit of this repository has them.
//
//   node sync.mjs <core> <extension>
//       Writes the files of the groups <extension>/core.json names, as
//       <core>'s HEAD has them under shared/, to the same paths in
//       <extension>, and locks that commit in core.json.
//   node sync.mjs --check <core> <extension>
//       Exits 1 when a file of those groups differs from the locked commit's
//       copy, in its bytes or in whether it is executable.
//
// Both read the files from the commit, not from <core>'s working tree, so the
// commit core.json names is the one whose files the extension holds.
//
// A sync refuses, and writes nothing, where the extension still holds a file
// the commit it locked before shared, in any group, as that commit had it, and
// the commit it is moving to does not give it: a file dropped, renamed or in a
// group the extension no longer takes. A copy that differs from the commit
// that shared it is the extension's own and is left alone.
//
// In a git repository whose core.filemode is false, as git sets it on Windows,
// the executable bit is the one git's index holds: a sync sets it there, and a
// check reads it from there. A file already in the index keeps what is staged
// for it and takes the bit alone; a file the index does not hold is added. A
// sync there refuses, and writes nothing, where a shared file is in a merge
// conflict or only intended to be added (git add -N).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG = 'core.json';
const COMMIT = /^[0-9a-f]{40}$/;

function git(core, args) {
  return execFileSync('git', ['-C', core, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' }
  });
}

function readConfig(extension) {
  const file = path.join(extension, CONFIG);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not readable: ${error.message}`);
  }
  if (typeof config?.core !== 'object' || config.core === null) {
    throw new Error(`${file} has no "core" object`);
  }
  const { groups } = config.core;
  if (!Array.isArray(groups) || groups.length === 0 || !groups.every((g) => typeof g === 'string')) {
    throw new Error(`${file} names no groups under "core"`);
  }
  return config;
}

function groupsAt(core, commit) {
  return JSON.parse(git(core, ['show', `${commit}:groups.json`]).toString('utf8'));
}

// The paths of the named groups at a commit, each once, in the order
// groups.json lists them.
function filesOf(core, commit, groups) {
  const table = groupsAt(core, commit);
  const files = [];
  for (const group of groups) {
    if (!Object.hasOwn(table, group)) throw new Error(`no group named ${group} at ${commit}`);
    for (const file of table[group]) if (!files.includes(file)) files.push(file);
  }
  return files;
}

// The bytes and the executable bit of shared/<file> at a commit.
function sharedAt(core, commit, file) {
  const listed = git(core, ['ls-tree', commit, '--', `shared/${file}`]).toString('utf8').trim();
  if (!listed) throw new Error(`shared/${file} is not in ${commit}`);
  const mode = listed.split(/\s/)[0];
  return { bytes: git(core, ['show', `${commit}:shared/${file}`]), executable: mode === '100755' };
}

// Windows keeps no executable bit for git to compare against.
const BIT_HELD = process.platform !== 'win32';

// Whether the extension is a git repository whose core.filemode is false.
function indexHoldsTheBit(extension) {
  try {
    return git(extension, ['config', '--type=bool', 'core.filemode']).toString('utf8').trim() === 'false';
  } catch {
    return false;
  }
}

// The shared files the index holds in a merge conflict, or only as intended
// to be added.
function unsettled(extension, files) {
  const status = git(extension, ['status', '--porcelain=v2', '--untracked-files=no', '--', ...files]).toString('utf8');
  return status.split('\n').filter((line) => line.startsWith('u ') || line.startsWith('1 .A '))
    .map((line) => line.split(' ').slice(line.startsWith('u ') ? 10 : 8).join(' '));
}

function setIndexBit(extension, file, executable) {
  const mode = executable ? '100755' : '100644';
  const listed = git(extension, ['ls-files', '--stage', '--', file]).toString('utf8').trim();
  if (!listed) {
    git(extension, ['add', `--chmod=${executable ? '+' : '-'}x`, '--', file]);
    return;
  }
  const [, blob] = listed.split(/\s/);
  git(extension, ['update-index', '--cacheinfo', `${mode},${blob},${file}`]);
}

// The files the commit locked before shared that the extension still holds
// as that commit had them, and that the commit it is moving to does not give it.
function leftBehind(core, extension, previous, files) {
  try {
    git(core, ['cat-file', '-e', `${previous}^{commit}`]);
  } catch {
    throw new Error(`${previous}, the commit ${CONFIG} locks, is not in ${core}`);
  }
  const before = [...new Set(Object.values(groupsAt(core, previous)).flat())];
  return before.filter((file) => {
    if (files.includes(file)) return false;
    let held;
    try {
      held = fs.readFileSync(path.join(extension, file));
    } catch {
      return false;
    }
    return held.equals(sharedAt(core, previous, file).bytes);
  });
}

function sync(core, extension) {
  const config = readConfig(extension);
  const commit = git(core, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const files = filesOf(core, commit, config.core.groups);
  const previous = config.core.commit;
  if (typeof previous === 'string' && COMMIT.test(previous)) {
    const left = leftBehind(core, extension, previous, files);
    if (left.length) {
      throw new Error(`${commit} no longer gives this extension what ${previous} shared, and it is still here:\n  `
        + `${left.join('\n  ')}\nremove it, then sync again`);
    }
  }
  const copies = files.map((file) => ({ file, ...sharedAt(core, commit, file) }));
  const inIndex = indexHoldsTheBit(extension);
  if (inIndex) {
    const held = unsettled(extension, files);
    if (held.length) {
      throw new Error(`git's index holds these in a merge conflict or only as intended to be added:\n  `
        + `${held.join('\n  ')}\nsettle them, then sync again`);
    }
  }
  for (const { file, bytes, executable } of copies) {
    const target = path.join(extension, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    if (BIT_HELD) fs.chmodSync(target, executable ? 0o755 : 0o644);
    if (inIndex) setIndexBit(extension, file, executable);
    console.log(`  = ${file}`);
  }
  config.core.commit = commit;
  fs.writeFileSync(path.join(extension, CONFIG), JSON.stringify(config, null, 2) + '\n');
  console.log(`\n=> ${files.length} files at ${commit}`);
}

function check(core, extension) {
  const config = readConfig(extension);
  const { commit } = config.core;
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    throw new Error(`${CONFIG} locks no commit: ${JSON.stringify(commit)}`);
  }
  const differing = [];
  const files = filesOf(core, commit, config.core.groups);
  const inIndex = indexHoldsTheBit(extension);
  for (const file of files) {
    const shared = sharedAt(core, commit, file);
    const target = path.join(extension, file);
    let held;
    try {
      held = fs.readFileSync(target);
    } catch {
      differing.push(`${file}: missing`);
      continue;
    }
    if (!held.equals(shared.bytes)) {
      differing.push(`${file}: differs from ${commit}`);
      continue;
    }
    let executable;
    if (inIndex) {
      const listed = git(extension, ['ls-files', '--stage', '--', file]).toString('utf8').trim();
      if (!listed) {
        differing.push(`${file}: not in git's index`);
        continue;
      }
      executable = listed.split(/\s/)[0] === '100755';
    } else if (BIT_HELD) {
      executable = (fs.statSync(target).mode & 0o111) !== 0;
    } else {
      continue;
    }
    if (executable !== shared.executable) {
      differing.push(`${file}: ${shared.executable ? 'not executable' : 'executable'}, unlike ${commit}`);
    }
  }
  if (differing.length) {
    for (const line of differing) console.error(`  ! ${line}`);
    console.error(`\n${differing.length} of ${files.length} shared files are not as ${commit} has them`);
    return 1;
  }
  console.log(`${files.length} shared files are as ${commit} has them`);
  return 0;
}

function main(argv) {
  if (argv.length === 3 && argv[0] === '--check') return check(argv[1], argv[2]);
  if (argv.length === 2 && !argv[0].startsWith('-')) {
    sync(argv[0], argv[1]);
    return 0;
  }
  console.error('usage: sync.mjs <core> <extension> | sync.mjs --check <core> <extension>');
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
