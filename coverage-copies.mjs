// coverage-copies.mjs — in the V8 coverage under <dir>, gives a script the
// tests ran from their copy of a mutation tool the URL of the shared file it
// is a copy of, so that shared/tools/coverage/v8-to-lcov.mjs counts the run
// for that file.
//   node coverage-copies.mjs <coverage dir>
// A copy is a file at tools/mutation/<name> in a box the tests make under the
// system's temporary directory (a directory named cv-…), where <name> is a
// file under shared/tools/mutation/. Every other script is left as it was.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shared', 'tools', 'mutation');
const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node coverage-copies.mjs <coverage dir>');
  process.exit(2);
}

const temporary = fs.realpathSync(os.tmpdir());
const names = new Set(fs.readdirSync(TOOLS));
let moved = 0;
for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json'))) {
  const at = path.join(dir, name);
  const coverage = JSON.parse(fs.readFileSync(at, 'utf8'));
  let changed = false;
  for (const script of coverage.result) {
    if (!script.url.startsWith('file:')) continue;
    const parts = path.relative(temporary, fileURLToPath(script.url)).split(path.sep);
    if (parts.length !== 4 || !parts[0].startsWith('cv-') || parts[1] !== 'tools' || parts[2] !== 'mutation'
      || !names.has(parts[3])) continue;
    script.url = pathToFileURL(path.join(TOOLS, parts[3])).href;
    changed = true;
    moved += 1;
  }
  if (changed) fs.writeFileSync(at, JSON.stringify(coverage));
}
console.log(`${moved} scripts run from copies counted as shared/tools/mutation/ files`);
