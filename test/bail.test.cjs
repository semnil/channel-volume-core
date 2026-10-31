// bail.test.cjs — tools/mutation/bail.mjs ends a run at the first line that
// reports a failed check, and changes nothing else about how the run ends: for
// a node:test suite and for a suite whose own runner prints `  FAIL:` lines.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { shared, tempDir } = require('./helpers.cjs');

const BAILER = shared('tools', 'mutation', 'bail.mjs');

// The patterns the sweep commands hand bail.mjs, and the lines each one is
// there to find.
const RUNNERS = [
  {
    what: "node:test's failure lines",
    // The line node:test prints for a failed test, `✖ <name>` from the spec
    // reporter and `not ok <n> - <name>` from the TAP reporter, whichever the
    // Node running the suite writes to a pipe.
    pattern: '^(✖|not ok) ',
    quoted: 'a note: ✖ quoted, not reported',
    // The failure line arrives in three writes, the first of which ends inside
    // the line's first character.
    failWrites: [
      "const line = Buffer.from('✖ split inside a character and across writes\\n');",
      'process.stderr.write(line.subarray(0, 2));',
      'setTimeout(() => process.stderr.write(line.subarray(2, 6)), 50);',
      'setTimeout(() => process.stderr.write(line.subarray(6)), 100);'
    ],
    failLine: '✖ split inside a character and across writes',
    onTheWayOut: '✖ on the way out',
    nodeTest: true
  },
  {
    what: "a custom runner's FAIL lines",
    // The line a suite with a runner of its own prints for a failed check.
    pattern: '^  FAIL:',
    quoted: 'a note:  FAIL: quoted, not reported',
    // The failure line arrives in two writes, split inside its marker.
    failWrites: [
      "process.stderr.write('  FA');",
      "setTimeout(() => process.stderr.write('IL: split across two writes\\n'), 50);"
    ],
    failLine: '  FAIL: split across two writes',
    onTheWayOut: '  FAIL: on the way out',
    nodeTest: false
  }
];

for (const runner of RUNNERS) {
  test(`bail.mjs ends a run at the first failed test, and in no other way (${runner.what})`, async (t) => {
    // What it may change is when a run ends, never which way it ends: a run with
    // no failure in it ends as the suite ended, and a run a signal took ends by
    // that signal. The cases run side by side, since each is mostly waiting.
    const pattern = runner.pattern;
    const box = tempDir('cv-bail-');
    const write = (name, text) => fs.writeFileSync(path.join(box, name), text);
    const processIdIn = (name) => {
      try { return Number(fs.readFileSync(path.join(box, name), 'utf8')); } catch { return 0; }
    };
    const alive = (processId) => { try { process.kill(processId, 0); return true; } catch { return false; } };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
    // Until ready() holds or the run has ended: a suite a loaded machine is
    // slow to start is waited on, not signalled before it is up.
    const until = async (ready, run) => {
      while (!ready() && run.endedAt === undefined) await tick();
    };
    // A process just killed can still be in the table until it is reaped.
    const gone = async (processId) => {
      for (let turn = 0; turn < 100 && alive(processId); turn++) await tick();
      return !alive(processId);
    };
    // '' where the process has gone; where it has not, what ps says of it and
    // of every process in its group, and whether it goes within 10 s more.
    const goneOrWhy = async (processId) => {
      if (await gone(processId)) return '';
      const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,etime=,command='], { encoding: 'utf8' }).stdout
        .split('\n').map((line) => line.trim()).filter(Boolean);
      const own = table.find((line) => line.split(/\s+/)[0] === String(processId)) || '';
      const group = own.split(/\s+/)[2];
      const members = group ? table.filter((line) => line.split(/\s+/)[2] === group) : [];
      const waitedFrom = Date.now();
      for (let turn = 0; turn < 1000 && alive(processId); turn++) await tick();
      const later = alive(processId) ? 'still there 10 s later' : `gone ${Date.now() - waitedFrom} ms later`;
      return `; still there 1 s on: [${own}]; its group: [${members.join(' | ')}]; ${later}`;
    };
    const bail =(args, { during, env } = {}) => new Promise((resolve) => {
      const run = { stdout: '', stderr: '', timedOut: false };
      const child = spawn('node', [BAILER, ...args], { cwd: box, env: env || process.env });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { run.stdout += chunk; });
      child.stderr.on('data', (chunk) => { run.stderr += chunk; });
      const guard = setTimeout(() => { run.timedOut = true; child.kill('SIGKILL'); }, 15000);
      child.on('close', (status, signal) => { clearTimeout(guard); run.endedAt = Date.now(); resolve({ ...run, status, signal }); });
      if (during) during(child, run);
    });
    // What these cases start runs until a stop takes it, and each of them also
    // ends once this suite's process is gone: a run of this suite stopped while
    // these cases are under way (a sweep's bail.mjs, at an earlier failure)
    // leaves none of them running.
    const idle = `setInterval(() => { try { process.kill(${process.pid}, 0); } catch { process.exit(); } }, 100)`;
    const forever = `${idle};\n`;
    try {
      if (process.platform === 'win32') {
        const refused = await bail([pattern, 'node', '-e', '0']);
        assert.equal(refused.status, 2, JSON.stringify(refused));
        assert.match(refused.stderr, /Windows does not have/, 'on Windows it refuses rather than leaving a suite running');
        t.skip('Windows has no process groups; only the refusal is asked');
        return;
      }
      write('pass.js', `console.log('ok');\nconsole.error(${JSON.stringify(runner.quoted)});\n`);
      write('status.js', 'process.exitCode = 3;\n');
      write('fail.js', [
        "const { spawn } = require('child_process');",
        "const fs = require('fs');",
        `const below = spawn('node', ['-e', ${JSON.stringify(idle)}], { stdio: 'ignore' });`,
        "fs.writeFileSync('below.pid', String(below.pid));",
        "fs.writeFileSync('fail.pid', String(process.pid));",
        ...runner.failWrites,
        forever
      ].join('\n'));
      // What node:test itself prints for a failed test, ahead of a test that
      // never ends.
      write('node-test.js', [
        "const { test } = require('node:test');",
        "require('fs').writeFileSync('node-test.pid', String(process.pid));",
        "test('fails first', () => { throw new Error('the first failure'); });",
        `test('never ends', () => new Promise(() => ${idle}));`,
        ''
      ].join('\n'));
      write('self-signal.js', "process.kill(process.pid, 'SIGTERM');\n" + forever);
      write('wait.js', "require('fs').writeFileSync('wait.pid', String(process.pid));\n" + forever);
      write('answers.js', [
        "require('fs').writeFileSync('answers.pid', String(process.pid));",
        `process.on('SIGTERM', () => { console.error(${JSON.stringify(runner.onTheWayOut)}); process.exit(0); });`,
        forever
      ].join('\n'));
      // A suite that has ended while something it left in a group of its own
      // still holds the output open: the run is still waiting on the output,
      // a signal that reaches it then finds no group to pass to, and the run
      // ends without waiting on the output any longer.
      write('gone.js', [
        "const { spawn } = require('child_process');",
        "const fs = require('fs');",
        `const left = spawn('node', ['-e', ${JSON.stringify(idle)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });`,
        'left.unref();',
        "fs.writeFileSync('left.pid', String(left.pid));",
        "fs.writeFileSync('gone.pid', String(process.pid));",
        ''
      ].join('\n'));
      // A suite that does nothing with SIGTERM but go on, and something it
      // started.
      write('deaf.js', [
        "const { spawn } = require('child_process');",
        "process.on('SIGTERM', () => {});",
        `const below = spawn('node', ['-e', ${JSON.stringify(idle)}], { stdio: 'ignore' });`,
        "require('fs').writeFileSync('deaf-child.pid', String(below.pid));",
        "require('fs').writeFileSync('deaf-suite.pid', String(process.pid));",
        forever
      ].join('\n'));
      // A suite the signal takes while something it started in its group
      // holds the output open and does not end on that signal.
      write('deaf-below.js', [
        "const { spawn } = require('child_process');",
        "require('fs').writeFileSync('deaf-below.pid', String(process.pid));",
        `spawn('node', ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('fs').writeFileSync('deaf.pid', String(process.pid)); ${idle}`)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
        forever
      ].join('\n'));
      // A suite that prints on its way out to a reader that has gone, as the
      // sweep's timeout leaves it.
      write('unread.js', [
        "process.on('SIGTERM', () => { console.log('on the way out'); process.exit(0); });",
        "require('fs').writeFileSync('unread.pid', String(process.pid));",
        forever
      ].join('\n'));
      // A suite that ends with no signal while something it started in its
      // group has a line still to print.
      write('after.js', [
        "const { spawn } = require('child_process');",
        "spawn('node', ['-e', \"setTimeout(() => console.log('later'), 100)\"], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();",
        ''
      ].join('\n'));
      // A suite that ends having printed more than the reader has taken in,
      // so that the run is still passing it on once the suite is gone. The
      // reader takes the rest in once the suite has ended, or, where a
      // signal is sent then, once the run has said it passed the signal on.
      write('big.js', "require('fs').writeFileSync(process.argv[2], String(process.pid));\nprocess.stdout.write('x'.repeat(4 * 1024 * 1024));\n");
      const slowReader = (idFile, signalled) => async (child, run) => {
        child.stdout.pause();
        await until(() => processIdIn(idFile) && !alive(processIdIn(idFile)), run);
        if (!signalled) {
          child.stdout.resume();
          return;
        }
        child.stderr.on('data', () => { if (run.stderr.includes('passed on')) child.stdout.resume(); });
        child.kill('SIGTERM');
      };
      const signalOnce = (idFile) => async (child, run) => {
        await until(() => processIdIn(idFile), run);
        run.signalledAt = Date.now();
        run.idAtSignal = processIdIn(idFile);
        child.kill('SIGTERM');
      };
      // Run by `node --test`, this file has NODE_TEST_CONTEXT in its
      // environment, and a node:test file started with it writes its results
      // for that runner rather than as lines. A sweep starts the suite without it.
      const sweepEnv = { ...process.env };
      delete sweepEnv.NODE_TEST_CONTEXT;
      const [passed, status, failed, nodeTest, signalled, stopped, answered, late, held, outlasted, unread, after, drained, drainedLate, badPattern, noCommand, unrunnable] = await Promise.all([
        bail([pattern, 'node', 'pass.js']),
        bail([pattern, 'node', 'status.js']),
        bail([pattern, 'node', 'fail.js']),
        runner.nodeTest ? bail([pattern, 'node', 'node-test.js'], { env: sweepEnv }) : null,
        bail([pattern, 'node', 'self-signal.js']),
        bail([pattern, 'node', 'wait.js'], { during: signalOnce('wait.pid') }),
        bail([pattern, 'node', 'answers.js'], { during: signalOnce('answers.pid') }),
        bail([pattern, 'node', 'gone.js'], {
          during: async (child, run) => {
            await until(() => processIdIn('left.pid') && processIdIn('gone.pid') && !alive(processIdIn('gone.pid')), run);
            child.kill('SIGTERM');
          }
        }),
        bail([pattern, 'node', 'deaf-below.js'], { during: signalOnce('deaf.pid') }),
        bail([pattern, 'node', 'deaf.js'], { during: signalOnce('deaf-suite.pid') }),
        bail([pattern, 'node', 'unread.js'], {
          during: async (child, run) => {
            await until(() => processIdIn('unread.pid'), run);
            child.stdout.destroy();
            child.stderr.destroy();
            child.kill('SIGTERM');
          }
        }),
        bail([pattern, 'node', 'after.js']),
        bail([pattern, 'node', 'big.js', 'big.pid'], { during: slowReader('big.pid', false) }),
        bail([pattern, 'node', 'big.js', 'big-late.pid'], { during: slowReader('big-late.pid', true) }),
        bail(['(', 'node', 'pass.js']),
        bail([pattern]),
        bail([pattern, 'no-such-command-for-bail'])
      ]);
      assert.ok(passed.status === 0 && passed.signal === null && passed.stdout === 'ok\n'
        && passed.stderr === `${runner.quoted}\n`,
        `a run with no failure in it exits as the suite did, its output passed through (${JSON.stringify(passed)})`);
      assert.equal(status.status, 3, `a suite's own status is the run's (${JSON.stringify(status)})`);
      assert.ok(!failed.timedOut && failed.status === 1 && failed.signal === null
        && failed.stderr.includes(runner.failLine),
        `the first failure ends a run that would go on for ever, as failed (${JSON.stringify(failed)})`);
      const belowWhy = processIdIn('below.pid') > 0 ? await goneOrWhy(processIdIn('below.pid')) : '; no process id';
      assert.ok(belowWhy === '',
        `and what the suite started goes with it (${processIdIn('below.pid')}${belowWhy})`);
      if (runner.nodeTest) {
        assert.ok(!nodeTest.timedOut && nodeTest.status === 1 && nodeTest.signal === null,
          `the pattern is the line node:test prints for a failed test (${JSON.stringify(nodeTest)})`);
      }
      assert.ok(signalled.status === null && signalled.signal === 'SIGTERM',
        `a suite a signal took ends the run by that signal (${JSON.stringify(signalled)})`);
      assert.ok(!stopped.timedOut && stopped.status === null && stopped.signal === 'SIGTERM',
        `a signal sent to the run ends it by that signal (${JSON.stringify(stopped)})`);
      const waitWhy = processIdIn('wait.pid') > 0 ? await goneOrWhy(processIdIn('wait.pid')) : '; no process id';
      assert.ok(waitWhy === '',
        `and reaches the suite (${processIdIn('wait.pid')}${waitWhy}; the run: ${JSON.stringify(stopped)})`);
      assert.ok(!answered.timedOut && answered.status === null && answered.signal === 'SIGTERM',
        `a suite that answers the signal by exiting 0, a failure on its way out, still ends the run by it (${JSON.stringify(answered)})`);
      assert.ok(!late.timedOut && late.status === null && late.signal === 'SIGTERM'
        && late.stderr === 'bail.mjs: SIGTERM passed on to the suite\n',
        `a signal that finds the suite's group gone still ends the run by it, though what the suite left holds the output (${JSON.stringify(late)})`);
      assert.ok(!held.timedOut && held.status === null && held.signal === 'SIGTERM',
        `a signal ends the run once the suite has ended, though what it started holds the output and outlives the signal (${JSON.stringify(held)})`);
      const deafWhy = processIdIn('deaf.pid') > 0 ? await goneOrWhy(processIdIn('deaf.pid')) : '; no process id';
      assert.ok(deafWhy === '',
        `and that goes with the rest of the suite's group (${processIdIn('deaf.pid')}${deafWhy})`);
      assert.ok(!outlasted.timedOut && outlasted.status === null && outlasted.signal === 'SIGTERM'
        && outlasted.endedAt - outlasted.signalledAt >= 4900,
        `a suite that goes on past a signal is given 5 s, and the run then ends by the signal (${JSON.stringify({ ...outlasted, afterSignalMs: outlasted.endedAt - outlasted.signalledAt })})`);
      const deafSuiteWhy = processIdIn('deaf-suite.pid') > 0 ? await goneOrWhy(processIdIn('deaf-suite.pid')) : '; no process id';
      const deafChildWhy = processIdIn('deaf-child.pid') > 0 ? await goneOrWhy(processIdIn('deaf-child.pid')) : '; no process id';
      assert.ok(deafSuiteWhy === '' && deafChildWhy === '',
        `and it goes with its group, what it started too (${processIdIn('deaf-suite.pid')}${deafSuiteWhy}, ${processIdIn('deaf-child.pid')}${deafChildWhy})`);
      assert.ok(!unread.timedOut && unread.status === null && unread.signal === 'SIGTERM',
        `a run whose reader has gone still ends by the signal, whatever the suite prints on its way out (${JSON.stringify(unread)})`);
      assert.ok(after.status === 0 && after.signal === null && after.stdout === 'later\n',
        `a run no signal reached waits on the output of what the suite left, as the suite's own caller would (${JSON.stringify(after)})`);
      const sized = (run) => JSON.stringify({ ...run, stdout: run.stdout.length });
      assert.ok(!drained.timedOut && drained.status === 0 && drained.signal === null
        && drained.stdout.length === 4 * 1024 * 1024,
        `a run whose reader is slow to take the output in ends as the suite did, all of it passed on (${sized(drained)})`);
      assert.ok(!drainedLate.timedOut && drainedLate.status === null && drainedLate.signal === 'SIGTERM'
        && drainedLate.stdout.length === 4 * 1024 * 1024
        && drainedLate.stderr === 'bail.mjs: SIGTERM passed on to the suite\n',
        `a signal that comes once the suite has ended, while its output is still being passed on, ends the run by it (${sized(drainedLate)})`);
      assert.ok(badPattern.status === 2 && /is not a regular expression/.test(badPattern.stderr),
        `a pattern that is not one is refused (${JSON.stringify(badPattern)})`);
      assert.ok(noCommand.status === 2 && /^usage:/.test(noCommand.stderr),
        `a run with no suite is refused (${JSON.stringify(noCommand)})`);
      assert.ok(unrunnable.status === 127 && /could not be run \(ENOENT\)/.test(unrunnable.stderr),
        `a suite that cannot be started is said to be one (${JSON.stringify(unrunnable)})`);
    } finally {
      // What a stop that did not take left running, and only where the process
      // under that process id is still the one these cases started.
      for (const [name, started] of [['below.pid', 'setInterval'], ['fail.pid', 'fail.js'], ['node-test.pid', 'node-test.js'], ['wait.pid', 'wait.js'], ['answers.pid', 'answers.js'], ['left.pid', 'setInterval'], ['deaf-below.pid', 'deaf-below.js'], ['deaf.pid', 'setInterval'], ['deaf-suite.pid', 'deaf.js'], ['deaf-child.pid', 'setInterval'], ['unread.pid', 'unread.js']]) {
        const processId = processIdIn(name);
        const now = processId && alive(processId) ? spawnSync('ps', ['-o', 'command=', '-p', String(processId)], { encoding: 'utf8' }).stdout || '' : '';
        if (now.includes(started)) process.kill(processId, 'SIGKILL');
      }
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
}
