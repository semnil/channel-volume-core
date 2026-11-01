// loudness.test.cjs — core/loudness.js and audio-worklet.js, the measurement
// the extensions share: the one name the script declares, the K-weighting and
// its redesign for a sample rate, a mean square as LUFS, a block referenced to
// volume 1, the chain the worklet is built into, the worklet's blocks, and the
// meter: Momentary and Short-term, the gated Integrated level and its index,
// the seed from a saved value, held windows, the boundary skip and the removal
// of recent windows.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { shared } = require('./helpers.cjs');

const SOURCE = fs.readFileSync(shared('core', 'loudness.js'), 'utf8');
const WORKLET_SOURCE = fs.readFileSync(shared('audio-worklet.js'), 'utf8');

// The file run as the extensions run it, a classic script, in a context of its
// own holding what the case gives it.
function load(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(SOURCE, context, { filename: 'core/loudness.js' });
  return { context, L: vm.runInContext('channelVolumeLoudness', context) };
}

const { L } = load();

// ── An oracle of the measurement, written over arrays ────────────────────────

function lufsOf(meanSquare) {
  if (!Number.isFinite(meanSquare) || meanSquare <= 0) return -Infinity;
  return -0.691 + 10 * Math.log10(meanSquare);
}

const meanSquareOf = (lufs) => Math.pow(10, (lufs + 0.691) / 10);
const ABSOLUTE_GATE = meanSquareOf(-70);
const RING = 60 * 60 * 10;

// BS.1770 gated loudness of a set of gating windows: the absolute gate at -70
// LUFS, then the relative gate 10 LU under the mean of what passed it.
function gatedLufs(windows) {
  const valid = windows.filter((ms) => Number.isFinite(ms) && ms > 0);
  const passAbs = valid.filter((ms) => ms >= ABSOLUTE_GATE);
  if (passAbs.length === 0) return -Infinity;
  const meanAbs = passAbs.reduce((s, v) => s + v, 0) / passAbs.length;
  const relGate = meanSquareOf(lufsOf(meanAbs) - 10);
  const passRel = passAbs.filter((ms) => ms >= relGate);
  if (passRel.length === 0) return -Infinity;
  return lufsOf(passRel.reduce((s, v) => s + v, 0) / passRel.length);
}

// One window per block from the fourth on, the mean of the last four.
function gatingWindows(blocks) {
  const windows = [];
  for (let i = 3; i < blocks.length; i++) {
    windows.push((blocks[i - 3] + blocks[i - 2] + blocks[i - 1] + blocks[i]) / 4);
  }
  return windows;
}

function assertLufsClose(actual, expected, message) {
  if (expected === -Infinity) assert.equal(actual, -Infinity, message);
  else assert.ok(Math.abs(actual - expected) < 1e-12, `${message || ''} ${actual} vs ${expected}`);
}

// The blocks fed to a meter, each answer kept.
function feed(meter, blocks, hold = false) {
  return blocks.map((ms) => meter.addBlock(ms, hold));
}

const last = (answers) => answers.at(-1);

// ── The script ────────────────────────────────────────────────────────────────

test('loudness.js declares one name and reaches for no extension API', () => {
  // The page shares the world the script is loaded into, so what it declares
  // at the top level is the page's too.
  const lines = SOURCE.split('\n');
  const top = lines.filter((line) => line && !line.startsWith('//') && !/^\s/.test(line));
  assert.deepEqual(top, ['const channelVolumeLoudness = (() => {', '})();']);

  const reached = [];
  const globals = {};
  Object.defineProperty(globals, 'chrome', { get() { reached.push('chrome'); return {}; }, enumerable: true });
  const context = vm.createContext(globals);
  const before = Object.getOwnPropertyNames(context).sort();
  vm.runInContext(SOURCE, context, { filename: 'core/loudness.js' });
  const meter = vm.runInContext('channelVolumeLoudness.createMeter()', context);
  meter.addBlock(0.1, false);
  assert.deepEqual(reached, [], 'chrome is not read');
  assert.deepEqual(Object.getOwnPropertyNames(context).sort(), before, 'nothing is put on the global object');
  assert.equal(vm.runInContext('typeof channelVolumeLoudness', context), 'object');
  assert.throws(() => vm.runInContext(SOURCE, context), /already been declared/,
    'the name is a lexical declaration the page cannot declare over');
});

test('what the script hands out cannot be written to', () => {
  assert.ok(Object.isFrozen(L), 'the API');
  for (const coef of [L.K_PRE_48K, L.K_RLB_48K]) {
    assert.ok(Object.isFrozen(coef) && Object.isFrozen(coef.b) && Object.isFrozen(coef.a), 'the coefficients');
  }
  assert.ok(Object.isFrozen(L.createMeter()), 'a meter');
});

test('the measurement runs on 100 ms blocks, BS.1770-4 windows and the seed bounds', () => {
  assert.equal(L.BLOCK_SEC, 0.1);
  assert.equal(L.MOMENTARY_BLOCKS, 4);
  assert.equal(L.SHORT_BLOCKS, 30);
  assert.equal(L.GATE_BLOCKS, 4);
  assert.equal(L.MAX_INTEGRATED_BLOCKS, RING);
  assert.equal(L.MIN_SEED_WINDOWS, 300);
  assert.equal(L.MAX_SEED_WINDOWS, 1800);
  assert.equal(L.BOUNDARY_SKIP_BLOCKS, 4);
  assert.equal(L.WORKLET_PROCESSOR, 'k-mean-square');
});

// ── K-weighting ───────────────────────────────────────────────────────────────

test('the K-weighting at 48 kHz is the one written down, not one derived again', () => {
  assert.deepEqual([...L.K_PRE_48K.b], [1.53512485958697, -2.69169618940638, 1.19839281085285]);
  assert.deepEqual([...L.K_PRE_48K.a], [1.0, -1.69065929318241, 0.73248077421585]);
  assert.deepEqual([...L.K_RLB_48K.b], [1.0, -2.0, 1.0]);
  assert.deepEqual([...L.K_RLB_48K.a], [1.0, -1.99004745483398, 0.99007225036621]);

  const at48k = L.kForSampleRate(48000);
  assert.equal(at48k.pre, L.K_PRE_48K, 'the coefficients are used as they stand');
  assert.equal(at48k.rlb, L.K_RLB_48K);
  assert.equal(L.kForSampleRate(48000.5).pre, L.K_PRE_48K, 'within a hertz of the rate is that rate');

  const at44k1 = L.kForSampleRate(44100);
  assert.notEqual(at44k1.pre.b[0], L.K_PRE_48K.b[0],
    `another rate is designed for that rate (${at44k1.pre.b[0]})`);
  assert.notEqual(at44k1.rlb.a[1], L.K_RLB_48K.a[1], 'both filters with it');
  assert.equal(L.kForSampleRate(48001).pre.a[0], 1, 'a hertz off is designed again');
  assert.notEqual(L.kForSampleRate(48001).pre, L.K_PRE_48K);
});

// The magnitude of a biquad at a frequency, for the rate it runs at.
function magnitude({ b, a }, frequency, rate) {
  const w = 2 * Math.PI * frequency / rate;
  const at = (c) => {
    const re = c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w);
    const im = -(c[1] * Math.sin(w) + c[2] * Math.sin(2 * w));
    return Math.hypot(re, im);
  };
  return at(b) / at(a);
}

test('the K-weighting designed for another rate weighs the same frequencies', () => {
  for (const rate of [44100, 96000]) {
    const there = L.kForSampleRate(rate);
    for (const frequency of [100, 1000, 4000]) {
      for (const filter of ['pre', 'rlb']) {
        const at48k = magnitude(L.kForSampleRate(48000)[filter], frequency, 48000);
        const atRate = magnitude(there[filter], frequency, rate);
        assert.ok(Math.abs(20 * Math.log10(atRate / at48k)) < 0.05,
          `${filter} at ${frequency} Hz, ${rate} Hz: ${atRate} vs ${at48k}`);
      }
    }
  }
  // Brought back to the rate it was written at, a filter is the one written.
  const back = L.redesignBiquad(L.K_PRE_48K, 48000, 48000);
  back.b.forEach((value, i) => assert.ok(Math.abs(value - L.K_PRE_48K.b[i]) < 1e-12));
});

// ── Levels ────────────────────────────────────────────────────────────────────

test('a mean square is read as LUFS, and no power as no level', () => {
  assert.ok(Math.abs(L.meanSquareToLufs(1.0) - (-0.691)) < 1e-12);
  assert.ok(Math.abs(L.meanSquareToLufs(0.01) - (-20.691)) < 1e-12);
  for (const ms of [0, -0.5, NaN, Infinity, -Infinity, undefined]) {
    assert.equal(L.meanSquareToLufs(ms), -Infinity, String(ms));
  }
});

test('a block is referenced to volume 1, and left as it is outside 0 to 1', () => {
  assert.equal(L.normalizeForVolume(0.01, 0.5), 0.01 / 0.25);
  assert.equal(L.normalizeForVolume(0.01, 0.1), 0.01 / (0.1 * 0.1));
  for (const volume of [1, 2, 0, -0.5, NaN, Infinity, undefined, '0.5']) {
    assert.equal(L.normalizeForVolume(0.01, volume), 0.01, String(volume));
  }
});

// ── The chain ─────────────────────────────────────────────────────────────────

// An AudioContext that records what is built and what is connected to what.
function fakeContext(sampleRate) {
  const made = [];
  const links = [];
  const node = (kind, extra = {}) => {
    const n = { kind, connect(to) { links.push([n.kind, to.kind]); }, ...extra };
    made.push(n);
    return n;
  };
  const context = {
    sampleRate,
    destination: { kind: 'destination' },
    createIIRFilter(feedforward, feedback) {
      return node(`iir${made.filter((n) => n.kind.startsWith('iir')).length}`, { feedforward, feedback });
    },
    createGain() { return node('gain', { gain: { value: 1 } }); }
  };
  const workletNodes = [];
  class AudioWorkletNode {
    constructor(ctx, name, options) {
      Object.assign(this, { kind: 'worklet', ctx, name, options, port: {} });
      this.connect = (to) => links.push(['worklet', to.kind]);
      workletNodes.push(this);
    }
  }
  return { context, made, links, workletNodes, AudioWorkletNode };
}

test('the chain carries the source through both filters to the worklet and out silent', () => {
  for (const rate of [48000, 44100]) {
    const fake = fakeContext(rate);
    const { L: loaded } = load({ AudioWorkletNode: fake.AudioWorkletNode });
    const source = { kind: 'source', connect(to) { fake.links.push(['source', to.kind]); } };
    const onBlock = () => {};
    const node = loaded.buildChain(fake.context, source, onBlock);

    assert.equal(node, fake.workletNodes[0], 'the worklet node is answered');
    assert.equal(node.ctx, fake.context);
    assert.equal(node.name, 'k-mean-square');
    assert.equal(node.options.processorOptions.blockSec, 0.1);
    assert.equal(node.port.onmessage, onBlock, 'its blocks reach the caller');
    const k = loaded.kForSampleRate(rate);
    const [pre, rlb] = fake.made.filter((n) => n.kind.startsWith('iir'));
    assert.deepEqual([...pre.feedforward], [...k.pre.b], `the pre-filter at ${rate}`);
    assert.deepEqual([...pre.feedback], [...k.pre.a]);
    assert.deepEqual([...rlb.feedforward], [...k.rlb.b], `the high-pass at ${rate}`);
    assert.deepEqual([...rlb.feedback], [...k.rlb.a]);
    assert.deepEqual(fake.links, [
      ['source', 'iir0'],
      ['iir0', 'iir1'],
      ['iir1', 'worklet'],
      ['worklet', 'gain'],
      ['gain', 'destination']
    ]);
    const silent = fake.made.find((n) => n.kind === 'gain');
    assert.equal(silent.gain.value, 0, 'the measurement path adds nothing to the output');
  }
});

// ── The worklet ───────────────────────────────────────────────────────────────

// audio-worklet.js runs in an AudioContext, where the base class, the sample
// rate and the registration function are globals the browser provides.
function createWorkletHarness({ sampleRate = 48000, processorOptions } = {}) {
  const posted = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage(message) { posted.push(message); } };
    }
  }
  let registered = null;
  const context = vm.createContext({
    AudioWorkletProcessor,
    sampleRate,
    registerProcessor(name, ctor) { registered = { name, ctor }; }
  });
  vm.runInContext(WORKLET_SOURCE, context, { filename: 'audio-worklet.js' });
  assert.ok(registered, 'the module registered a processor');
  return {
    name: registered.name,
    ctor: registered.ctor,
    posted,
    processor: new registered.ctor(
      processorOptions === undefined ? undefined : { processorOptions }
    ),
    // One render quantum of the channels given, as the browser hands them over.
    feed(processor, channels) { return processor.process([channels]); }
  };
}

// A run of one value, which makes the mean square of the block the value the
// case can work out by hand.
function samples(count, value) {
  return Float32Array.from({ length: count }, () => value);
}

test('the worklet registers under the name the chain asks for', () => {
  const harness = createWorkletHarness();
  // Renaming one side alone leaves the extension with no measurement path and
  // nothing that reads either file on its own would say so.
  assert.equal(harness.name, L.WORKLET_PROCESSOR);
  assert.deepEqual([...harness.ctor.parameterDescriptors], [], 'and takes no parameters');
});

test('the worklet posts one mean square per block of the sample rate', () => {
  const harness = createWorkletHarness({ sampleRate: 48000 });
  // 0.1 second at 48000 is 4800 samples.
  assert.equal(harness.feed(harness.processor, [samples(4799, 0.5)]), true);
  assert.deepEqual(harness.posted, [], 'nothing until the block is full');

  harness.feed(harness.processor, [samples(1, 0.5)]);

  // Mono counts the one channel on both sides, so each sample carries 2 x 0.25.
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].samples, 4800);
  assert.ok(Math.abs(harness.posted[0].ms - 0.5) < 1e-6);
});

test('the worklet counts the second channel where there is one', () => {
  const harness = createWorkletHarness({ sampleRate: 48000 });
  harness.feed(harness.processor, [samples(4800, 0.5), samples(4800, 0)]);

  assert.equal(harness.posted.length, 1);
  assert.ok(Math.abs(harness.posted[0].ms - 0.25) < 1e-6);
});

test('the worklet starts the next block empty', () => {
  const harness = createWorkletHarness({ sampleRate: 48000 });
  harness.feed(harness.processor, [samples(4800, 0.5)]);
  harness.feed(harness.processor, [samples(4800, 0)]);

  assert.equal(harness.posted.length, 2);
  assert.ok(Math.abs(harness.posted[0].ms - 0.5) < 1e-6);
  assert.equal(harness.posted[1].ms, 0, 'the loud block is not carried into it');
});

test('the worklet takes the block length from the sample rate it runs at', () => {
  const harness = createWorkletHarness({ sampleRate: 44100 });
  harness.feed(harness.processor, [samples(4410, 0.5)]);

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].samples, 4410);
});

test('the worklet takes the block length the chain asks for', () => {
  const harness = createWorkletHarness({ sampleRate: 48000, processorOptions: { blockSec: 0.05 } });
  harness.feed(harness.processor, [samples(2400, 0.5)]);

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].samples, 2400);
});

test('the worklet holds a floor under the block length', () => {
  // 0.0001 second at 48000 is under 5 samples. A block that short would post
  // ten thousand times a second.
  const harness = createWorkletHarness({ sampleRate: 48000, processorOptions: { blockSec: 0.0001 } });
  harness.feed(harness.processor, [samples(64, 0.5)]);

  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].samples, 64);
});

for (const [what, processorOptions] of [
  ['no options at all', undefined],
  ['options carrying nothing', {}],
  ['a block length of zero', { blockSec: 0 }],
  ['a block length that is not a number', { blockSec: 'a while' }]
]) {
  test(`the worklet falls back to a tenth of a second given ${what}`, () => {
    const harness = createWorkletHarness({ sampleRate: 48000, processorOptions });
    harness.feed(harness.processor, [samples(4800, 0.5)]);

    assert.equal(harness.posted.length, 1);
    assert.equal(harness.posted[0].samples, 4800);
  });
}

for (const [what, quantum] of [
  ['no inputs', []],
  ['an input with no channels', [[]]],
  ['a channel that is not there', [[undefined]]]
]) {
  test(`the worklet stays alive and posts nothing given ${what}`, () => {
    const harness = createWorkletHarness({ sampleRate: 48000 });
    assert.equal(harness.processor.process(quantum), true);
    assert.deepEqual(harness.posted, []);
  });
}

test('the worklet keeps what it has when a quantum brings no audio', () => {
  const harness = createWorkletHarness({ sampleRate: 48000 });
  harness.feed(harness.processor, [samples(4000, 0.5)]);
  harness.processor.process([]);
  harness.feed(harness.processor, [samples(800, 0.5)]);

  // The 4000 samples are still counted: a quantum with nothing in it is not a
  // reason to throw away the part of the block already measured.
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].samples, 4800);
  assert.ok(Math.abs(harness.posted[0].ms - 0.5) < 1e-6);
});

// ── The meter: Momentary and Short-term ──────────────────────────────────────

test('Momentary and Short-term are the last 4 and 30 blocks, or all there are', () => {
  const meter = L.createMeter();
  const first = meter.addBlock(0.04, false);
  assertLufsClose(first.momentary, lufsOf(0.04), 'one block');
  assertLufsClose(first.shortTerm, lufsOf(0.04));

  const blocks = Array.from({ length: 40 }, (_, i) => 0.01 + i * 0.001);
  const answers = feed(meter, blocks);
  const all = [0.04, ...blocks];
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  assertLufsClose(last(answers).momentary, lufsOf(mean(all.slice(-4))), 'momentary');
  assertLufsClose(last(answers).shortTerm, lufsOf(mean(all.slice(-30))), 'short-term');
  assertLufsClose(answers[1].shortTerm, lufsOf(mean(all.slice(0, 3))), 'short-term of three blocks');
});

test('the meter keeps reading the recent blocks however long it runs', () => {
  // The momentary and short-term readings are the last blocks; a run holds no
  // more than it reads from, or a long stream grows without end.
  const meter = L.createMeter();
  const steady = last(feed(meter, Array(400).fill(0.05)));
  assertLufsClose(steady.momentary, lufsOf(0.05));
  const loud = last(feed(meter, Array(4).fill(1.0)));
  assertLufsClose(loud.momentary, lufsOf(1.0), 'and follows what is playing now');
  assertLufsClose(loud.shortTerm, lufsOf((26 * 0.05 + 4) / 30));
});

test('a block of no power is no level', () => {
  const meter = L.createMeter();
  const answer = last(feed(meter, [0, 0, 0, 0]));
  assert.equal(answer.momentary, -Infinity);
  assert.equal(answer.shortTerm, -Infinity);
  assert.equal(answer.integrated.lufs, -Infinity, 'and nothing is integrated from it');
  assert.equal(answer.integrated.windows, 0);
});

// ── The meter: gating windows and Integrated ─────────────────────────────────

test('a gating window is the mean of the last four blocks, from the fourth on', () => {
  const meter = L.createMeter();
  const answers = feed(meter, [0.01, 0.02, 0.03, 0.06, 0.1]);
  assert.deepEqual(answers.slice(0, 3).map((a) => a.window), [null, null, null]);
  assert.equal(answers[3].window, (0.01 + 0.02 + 0.03 + 0.06) / 4);
  assert.equal(answers[4].window, (0.02 + 0.03 + 0.06 + 0.1) / 4);
  assert.equal(meter.windowsObserved(), 2, 'only blocks that complete a window count as one');
  assert.equal(meter.windowsSinceReset(), 2);
  assert.ok(answers.every((a) => a.skipped === false));
});

test('the meter reports no integrated level until something passes the gate', () => {
  // Below the absolute gate there is nothing a programme level could be read
  // from, and a seed weighted on nothing is worth no windows.
  const meter = L.createMeter();
  const quiet = last(feed(meter, Array(8).fill(ABSOLUTE_GATE / 100)));
  assert.equal(quiet.integrated.lufs, -Infinity);
  assert.equal(quiet.integrated.windows, 0);
  const heard = last(feed(meter, Array(8).fill(0.05)));
  assert.ok(Number.isFinite(heard.integrated.lufs), `once something does, there is (${heard.integrated.lufs})`);
  assert.ok(heard.integrated.windows > 0);
});

test('Integrated is invariant to the order of the gating windows', () => {
  // Spaced far enough apart that no window holds both loud sub-blocks, so
  // swapping them reorders the windows without changing the set.
  const quiet = 0.02;
  const forwardBlocks = [quiet, quiet, quiet, 1.0, quiet, quiet, quiet, 0.09, quiet, quiet, quiet];
  const reverseBlocks = [quiet, quiet, quiet, 0.09, quiet, quiet, quiet, 1.0, quiet, quiet, quiet];
  const sorted = (list) => gatingWindows(list).slice().sort((a, b) => a - b);
  assert.deepEqual(sorted(forwardBlocks), sorted(reverseBlocks));
  const forward = last(feed(L.createMeter(), forwardBlocks)).integrated.lufs;
  const reverse = last(feed(L.createMeter(), reverseBlocks)).integrated.lufs;
  assertLufsClose(forward, gatedLufs(gatingWindows(forwardBlocks)));
  assertLufsClose(reverse, gatedLufs(gatingWindows(forwardBlocks)));
});

test('the two-stage gate is kept incrementally, block by block', () => {
  const blocks = [0.01, 1.0, 0.001, 0.02, 0.5, 0.03, 0.04, 0.02, 0.05, 0.03, 0.02, 0.06];
  const answers = feed(L.createMeter(), blocks);
  for (let i = 0; i < blocks.length; i++) {
    assertLufsClose(answers[i].integrated.lufs, gatedLufs(gatingWindows(blocks.slice(0, i + 1))), `block ${i}`);
  }
});

test('the absolute gate keeps a window at -70 LUFS and drops one just under it', () => {
  const under = last(feed(L.createMeter(), Array(4).fill(ABSOLUTE_GATE * (1 - 1e-6))));
  assert.equal(under.integrated.lufs, -Infinity);
  const at = last(feed(L.createMeter(), Array(4).fill(ABSOLUTE_GATE)));
  assertLufsClose(at.integrated.lufs, -70);
  assert.equal(at.integrated.windows, 1);
});

test('the relative gate moves as quieter windows arrive', () => {
  const blocks = [1.0, 1.0, 1.0, 1.0, 0.1, 0.1, 0.1, 0.1, 0.055, 0.055, 0.055, 0.055];
  const answers = feed(L.createMeter(), blocks);
  for (let i = 0; i < blocks.length; i++) {
    assertLufsClose(answers[i].integrated.lufs, gatedLufs(gatingWindows(blocks.slice(0, i + 1))), `block ${i}`);
  }
  // The last window sits below the gate and is left out of the value.
  const windows = gatingWindows(blocks);
  assert.ok(gatedLufs(windows) > lufsOf(windows.at(-1)));
});

test('the indexed gate matches the array oracle across varied blocks', () => {
  const meter = L.createMeter();
  const blocks = [];
  let randomState = 0x12345678;
  for (let i = 0; i < 200; i++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    const ms = meanSquareOf(-80 + (randomState / 0xffffffff) * 80);
    blocks.push(ms);
    const actual = meter.addBlock(ms, false).integrated.lufs;
    const expected = gatedLufs(gatingWindows(blocks));
    if (expected === -Infinity) assert.equal(actual, -Infinity);
    else assert.ok(Math.abs(actual - expected) < 1e-10, `block ${i}: ${actual} vs ${expected}`);
  }
});

test('the ring keeps the last hour of windows and the index follows it', () => {
  const meter = L.createMeter();
  const emitted = [];
  let randomState = 0x87654321;
  for (let i = 0; i < 128; i++) {
    randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
    emitted.push(0.01 + randomState / 0xffffffff);
  }
  for (let i = 0; i < RING; i++) emitted.push(0.01 + i / RING);
  let answer;
  for (const ms of emitted) answer = meter.addBlock(ms, false);
  assert.ok(Math.abs(answer.integrated.lufs - gatedLufs(gatingWindows(emitted).slice(-RING))) < 1e-10);
});

test('the windows behind the value are the ones inside the gate', () => {
  const meter = L.createMeter();
  // Three blocks make no gating window, so nothing stands behind Integrated.
  assert.equal(last(feed(meter, Array(3).fill(0.1))).integrated.windows, 0);
  assert.equal(last(feed(meter, Array(10).fill(0.1))).integrated.windows, 10);
  // Of the 8 windows silence makes, the 3 still holding audio from the blocks
  // before it are counted.
  assert.equal(last(feed(meter, Array(8).fill(0))).integrated.windows, 13);
});

test('the windows behind the value are counted to the seed cap', () => {
  const meter = L.createMeter();
  const answer = last(feed(meter, Array(1900).fill(0.1)));
  assert.equal(answer.integrated.windows, 1800);
});

test('silence that turns the ring over leaves only what the index holds', () => {
  const meter = L.createMeter();
  feed(meter, Array(100).fill(0.1));
  // Silence reaches the ring but not the index, so it pushes the index empty:
  // an hour of windows, and the three of them still holding the audio before.
  let answer;
  for (let i = 0; i < RING + 3; i++) answer = meter.addBlock(0, false);
  assert.equal(answer.integrated.lufs, -Infinity);
  assert.equal(answer.integrated.windows, 0);
  assert.equal(last(feed(meter, Array(4).fill(0.1))).integrated.windows, 4);
});

// ── The meter: the seed ──────────────────────────────────────────────────────

// A seed that weighs one window is outweighed by the first second of the new
// session.
test('a saved LUFS is weighed by the windows it was measured over', () => {
  const savedLufs = -20;
  const next = 0.1;
  const saved = meanSquareOf(savedLufs);
  // [count stored with the value, windows the seed weighs, windows reported back]
  for (const [savedWindows, seed, reported] of [
    [undefined, 300, 1], [1, 300, 2], [299, 300, 300], [300, 300, 301],
    [1200, 1200, 1201], [1800, 1800, 1800], [36000, 1800, 1800]
  ]) {
    const meter = L.createMeter();
    meter.reset(savedLufs, savedWindows);
    const answer = last(feed(meter, Array(4).fill(next)));
    assertLufsClose(answer.integrated.lufs, lufsOf((saved * seed + next) / (seed + 1)), `seed of ${savedWindows}`);
    // The floor is not a measurement, so it is not reported as one.
    assert.equal(answer.integrated.windows, reported, `seed of ${savedWindows}`);
    assert.equal(meter.appendedWindowsSince(0), seed + 1, 'the seed is laid down in the ring');
  }
});

test('a saved window count that is not a count leaves the seed at the floor', () => {
  const saved = meanSquareOf(-20);
  for (const count of [NaN, -5, 0, 1.5, '600', Infinity, null, {}, 2 ** 53]) {
    const meter = L.createMeter();
    meter.reset(-20, count);
    const answer = last(feed(meter, Array(4).fill(0.1)));
    assertLufsClose(answer.integrated.lufs, lufsOf((saved * 300 + 0.1) / 301), String(count));
    assert.equal(answer.integrated.windows, 1, String(count));
  }
});

// Without the cap the seed loop runs once per claimed window, so a count this
// size does not come back at all.
test('a seed is held to what a seed may weigh', { timeout: 5000 }, () => {
  const meter = L.createMeter();
  meter.reset(-20, Number.MAX_SAFE_INTEGER);
  const answer = last(feed(meter, Array(4).fill(0.1)));
  assertLufsClose(answer.integrated.lufs, lufsOf((meanSquareOf(-20) * 1800 + 0.1) / 1801));
  assert.equal(answer.integrated.windows, 1800);
});

test('new windows displace a seed at the cap', () => {
  const meter = L.createMeter();
  // Within the relative gate of the audio that follows, so the seed stays in
  // the value and the count stays at what it came in with.
  meter.reset(-12, 1800);
  const first = last(feed(meter, Array(4).fill(0.5))).integrated.lufs;
  const later = last(feed(meter, Array(20).fill(0.5))).integrated;
  assert.equal(later.windows, 1800);
  assert.ok(later.lufs > first, `${later.lufs} vs ${first}`);
});

// The index keys on the level, so audio holding the level the seed sits at
// lands on the seed's own key. Which entries are the seed's is a matter of
// where they came from, not of what they are worth.
test('audio that holds the level the seed sits at is counted', () => {
  const meter = L.createMeter();
  const level = meanSquareOf(-18);
  meter.reset(-18, 100);
  // 597 windows, each landing on the seed's key.
  const answer = last(feed(meter, Array(600).fill(level)));
  assertLufsClose(answer.integrated.lufs, lufsOf(level));
  assert.equal(answer.integrated.windows, 100 + 597);
});

test('a seed the relative gate leaves out is not counted', () => {
  const meter = L.createMeter();
  const loud = meanSquareOf(-18);
  // A claim under the floor, so the seed's own entries outnumber what it says
  // the value stands on: what the gate does with them is then visible.
  meter.reset(-33, 100);
  assert.equal(last(feed(meter, Array(4).fill(loud))).integrated.windows, 101,
    'while the seed holds the gate up, it is inside the value');
  // Thirty seconds of audio 15 dB above it puts the seed under the gate.
  const answer = last(feed(meter, Array(296).fill(loud)));
  assertLufsClose(answer.integrated.lufs, lufsOf(loud));
  assert.equal(answer.integrated.windows, 297);
});

test('a seed under the absolute gate weighs nothing and is not counted', () => {
  const meter = L.createMeter();
  meter.reset(-70 - 1e-6, 1000);
  const answer = last(feed(meter, Array(4).fill(0.25)));
  assertLufsClose(answer.integrated.lufs, lufsOf(0.25));
  assert.equal(answer.integrated.windows, 1);

  // At the gate it is a level, and counted for what it claims.
  const atGate = L.createMeter();
  atGate.reset(-70, 1000);
  const silent = last(feed(atGate, Array(4).fill(0)));
  assertLufsClose(silent.integrated.lufs, -70);
  assert.equal(silent.integrated.windows, 1000);
});

test('a saved LUFS that is not a level seeds nothing', () => {
  for (const saved of [undefined, null, '-20', NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    const meter = L.createMeter();
    meter.reset(saved, 600);
    const answer = last(feed(meter, Array(4).fill(0.25)));
    assert.equal(answer.integrated.lufs, lufsOf(0.25), String(saved));
    assert.equal(answer.integrated.windows, 1, String(saved));
    assert.equal(meter.appendedWindowsSince(0), 1, `nothing is laid down for ${saved}`);
  }
});

test('the seed keeps its share of the window count as the ring turns over', () => {
  const meter = L.createMeter();
  meter.reset(-20, 100);
  // An hour of audio below the absolute gate fills the ring without entering
  // the index, so the seed is what the gate still holds when the oldest entry
  // starts falling out.
  // The 300 entries and the windows fill the hour at block 35703, and each
  // block after it evicts one of the seed's.
  let answer;
  for (let i = 0; i < 35_903; i++) answer = meter.addBlock(1e-9, false);
  assert.equal(answer.integrated.windows, 100, 'with 100 of the 300 entries still in the ring');
  answer = meter.addBlock(1e-9, false);
  assert.equal(answer.integrated.windows, 99, 'and one fewer as the next leaves');
  for (let i = 0; i < 98; i++) answer = meter.addBlock(1e-9, false);
  assert.equal(answer.integrated.windows, 1);
  answer = meter.addBlock(1e-9, false);
  assert.equal(answer.integrated.windows, 0, 'and none once the last has gone');
  assert.equal(answer.integrated.lufs, -Infinity);
});

test('a reset empties the measurement and starts the window count again', () => {
  const meter = L.createMeter();
  feed(meter, [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
  meter.reset();
  assert.equal(meter.windowsObserved(), 0);
  assert.equal(meter.windowsSinceReset(), 0);
  assert.equal(meter.appendedWindowsSince(0), 0);
  // The blocks before the reset are not part of the next window.
  const answers = feed(meter, [0.01, 0.01, 0.01, 0.01]);
  assert.equal(answers[2].window, null);
  assertLufsClose(answers[3].integrated.lufs, lufsOf(0.01));
  assert.equal(meter.windowsObserved(), 1);
});

// ── The meter: held windows, the boundary skip and fresh blocks ──────────────

test('a held window stays out of Integrated and is still observed', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.01));
  const held = feed(meter, Array(4).fill(1.0), true);
  assert.ok(held.every((a) => a.skipped === false), 'a hold is not a skip');
  assertLufsClose(last(held).integrated.lufs, lufsOf(0.01));
  assert.equal(last(held).integrated.windows, 1);
  assertLufsClose(last(held).momentary, lufsOf(1.0), 'Momentary still reads what plays');
  assert.equal(meter.windowsObserved(), 5);
  assert.equal(meter.windowsSinceReset(), 1);
});

test('a boundary keeps the next four windows out', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.01));
  meter.skipBoundary();
  assert.equal(meter.boundaryWindowsLeft(), 4);
  for (let i = 3; i >= 0; i--) {
    const answer = meter.addBlock(0.04, false);
    assert.equal(answer.skipped, true);
    assertLufsClose(answer.integrated.lufs, lufsOf(0.01));
    assert.equal(meter.boundaryWindowsLeft(), i);
  }
  const clear = meter.addBlock(0.04, false);
  assert.equal(clear.skipped, false, 'the fifth window is clear of the boundary');
  assertLufsClose(clear.integrated.lufs, gatedLufs([0.01, 0.04]));
  assert.equal(meter.windowsObserved(), 6);
  assert.equal(meter.windowsSinceReset(), 2);
});

test('a boundary counted again restarts the skip', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.01));
  meter.skipBoundary();
  feed(meter, [0.01, 0.01]);
  meter.skipBoundary();
  const answers = feed(meter, Array(4).fill(0.01));
  assert.deepEqual(answers.map((a) => a.skipped), [true, true, true, true]);
  assert.equal(meter.boundaryWindowsLeft(), 0);
  assert.equal(meter.windowsSinceReset(), 1);
});

test('a held window leaves the boundary skip where it is', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.01));
  meter.skipBoundary();
  const held = feed(meter, Array(6).fill(1.0), true);
  assert.ok(held.every((a) => a.skipped === false));
  assert.equal(meter.boundaryWindowsLeft(), 4, 'the skip waits for windows that are not held');
  assert.equal(meter.windowsSinceReset(), 1);
});

test('the boundary skip counts windows, not blocks, and runs on across a reset', () => {
  const meter = L.createMeter();
  meter.skipBoundary();
  const early = feed(meter, [1.0, 1.0, 1.0]);
  assert.ok(early.every((a) => a.skipped === false), 'blocks that make no window take none of it');
  assert.equal(meter.boundaryWindowsLeft(), 4);
  meter.reset();
  // The first three blocks after the reset form no window, then four windows
  // are dropped.
  const answers = feed(meter, Array(7).fill(0.25));
  assert.equal(last(answers).integrated.lufs, -Infinity);
  assert.equal(meter.boundaryWindowsLeft(), 0);
  assertLufsClose(meter.addBlock(0.25, false).integrated.lufs, lufsOf(0.25));
});

test('fresh blocks start a new gating window and keep Integrated', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.01));
  feed(meter, Array(3).fill(1.0));
  meter.clearBlocks();
  const answers = feed(meter, Array(3).fill(0.01));
  assert.ok(answers.every((a) => a.window === null), 'no window spans the blocks before');
  assertLufsClose(answers[0].momentary, lufsOf(0.01));
  const before = gatingWindows([0.01, 0.01, 0.01, 0.01, 1.0, 1.0, 1.0]);
  assertLufsClose(last(answers).integrated.lufs, gatedLufs(before));
  assertLufsClose(meter.addBlock(0.01, false).integrated.lufs, gatedLufs([...before, 0.01]));
  assert.equal(meter.windowsObserved(), 5);
});

// ── The meter: removing recent windows ───────────────────────────────────────

test('the most recent windows are removed, oldest first in the answer', () => {
  const meter = L.createMeter();
  // A ramp, so removing a different number of windows lands somewhere else.
  const blocks = Array.from({ length: 60 }, (_, i) => 0.01 + i * 0.0004);
  feed(meter, blocks);
  const windows = gatingWindows(blocks);
  const removed = meter.removeRecentWindows(5);
  assert.deepEqual([...removed], windows.slice(-5));
  assert.equal(meter.windowsSinceReset(), windows.length - 5);
  assert.equal(meter.windowsObserved(), windows.length, 'what was observed stays observed');
  const answer = meter.addBlock(1.0, true);
  assertLufsClose(answer.integrated.lufs, gatedLufs(windows.slice(0, -5)));
  assert.equal(meter.removeRecentWindows(0).length, 0);
});

test('a removal reaches only the windows since the last reset, never the seed', () => {
  const meter = L.createMeter();
  feed(meter, Array(20).fill(0.5));
  meter.reset(-20);
  feed(meter, Array(5).fill(1.0));
  const removed = meter.removeRecentWindows(5);
  assert.equal(removed.length, 2, 'the two windows since the reset');
  assert.equal(meter.windowsSinceReset(), 0);
  assertLufsClose(meter.addBlock(1.0, true).integrated.lufs, -20);
  assert.equal(meter.removeRecentWindows(1).length, 0);
});

test('a removal after the ring has turned over takes what the ring still holds', () => {
  const meter = L.createMeter();
  const quiet = 0.01;
  for (let i = 0; i < RING + 3; i++) meter.addBlock(quiet, false);
  const loud = feed(meter, Array(5).fill(1.0));
  assert.ok(last(loud).integrated.lufs > lufsOf(quiet) + 0.03);
  meter.removeRecentWindows(5);
  assertLufsClose(meter.addBlock(1.0, true).integrated.lufs, lufsOf(quiet));

  // Asked for more than the ring holds, it stops at the ring.
  const all = meter.removeRecentWindows(RING + 100);
  assert.equal(all.length, RING - 5);
  assert.equal(meter.addBlock(1.0, true).integrated.lufs, -Infinity);
});

test('a window exactly on the absolute gate leaves the index when removed', () => {
  const meter = L.createMeter();
  assertLufsClose(last(feed(meter, Array(4).fill(ABSOLUTE_GATE))).integrated.lufs, -70);
  meter.removeRecentWindows(1);
  assert.equal(meter.addBlock(ABSOLUTE_GATE, true).integrated.lufs, -Infinity);
});

test('a window under the absolute gate is removed from the ring alone', () => {
  const meter = L.createMeter();
  feed(meter, Array(4).fill(0.25));
  feed(meter, Array(4).fill(0));
  assert.deepEqual([...meter.removeRecentWindows(1)], [0]);
  const answer = meter.addBlock(0, true);
  const kept = gatingWindows([0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0]).slice(0, -1);
  assertLufsClose(answer.integrated.lufs, gatedLufs(kept));
  assert.equal(answer.integrated.windows, 4, 'the four windows holding audio stay in the index');
});

test('the windows appended since a window are the ones the ring holds from it on', () => {
  const meter = L.createMeter();
  meter.reset(-20, 100);
  feed(meter, Array(6).fill(0.1));
  // Windows 1 to 3 appended, 4 to 7 skipped at a boundary, 8 and 9 appended.
  meter.skipBoundary();
  feed(meter, Array(4).fill(0.1));
  feed(meter, Array(2).fill(0.1));
  assert.equal(meter.windowsObserved(), 9);
  assert.equal(meter.appendedWindowsSince(8), 2);
  assert.equal(meter.appendedWindowsSince(5), 2, 'a skipped window was never appended');
  assert.equal(meter.appendedWindowsSince(3), 3);
  assert.equal(meter.appendedWindowsSince(1), 5);
  assert.equal(meter.appendedWindowsSince(10), 0);
  assert.equal(meter.appendedWindowsSince(0), 305, 'the seed carries the stamp below the first window');
  assert.equal(meter.removeRecentWindows(meter.appendedWindowsSince(3)).length, 3);
  assert.equal(meter.windowsSinceReset(), 2);
});

// ── The index ─────────────────────────────────────────────────────────────────

// The tree the meter keeps is inside the script's closure. The functions are
// lifted out of the source text instead, which is the source the extensions
// ship.
function gateIndex() {
  const take = (name) => {
    const at = SOURCE.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `loudness.js declares ${name}`);
    let depth = 0;
    for (let i = SOURCE.indexOf('{', at); i < SOURCE.length; i++) {
      if (SOURCE[i] === '{') depth += 1;
      else if (SOURCE[i] === '}' && --depth === 0) return SOURCE.slice(at, i + 1);
    }
    throw new Error(`${name} does not close`);
  };
  const names = [
    'treeHeight', 'treeCount', 'treeSum', 'updateTreeNode', 'rotateTreeLeft',
    'rotateTreeRight', 'balanceTree', 'insertTreeValue', 'removeTreeValue', 'treeValuesAtOrAbove'
  ];
  const body = names.map(take).join('\n');
  return new Function(`${body}; return { insertTreeValue, removeTreeValue, treeCount, treeSum, treeValuesAtOrAbove };`)();
}

test('the index holds a window for as long as the ring does, and no longer', () => {
  // Every window a different level, the ring evicting the oldest once it is
  // full: the index holds what the ring holds, and its height stays inside the
  // AVL bound.
  const { insertTreeValue, removeTreeValue, treeCount } = gateIndex();
  const ringSize = 500;
  let root = null;
  const held = [];
  for (let i = 0; i < 5000; i++) {
    const meanSquare = 1e-3 * (1 + i * 1e-6);
    root = insertTreeValue(root, meanSquare);
    held.push(meanSquare);
    if (held.length > ringSize) root = removeTreeValue(root, held.shift());
  }
  const liveNodes = (node) => (node ? 1 + liveNodes(node.left) + liveNodes(node.right) : 0);
  assert.equal(treeCount(root), ringSize);
  assert.equal(liveNodes(root), ringSize, 'a window the ring evicted leaves the index too');
  assert.ok(root.height <= Math.ceil(1.44 * Math.log2(ringSize + 2)),
    `the index stays balanced (height ${root.height} over ${ringSize} windows)`);
});

test('the index rebalances whichever way the levels lean', () => {
  const { insertTreeValue, removeTreeValue } = gateIndex();
  const grow = (values) => values.reduce((root, v) => insertTreeValue(root, v), null);
  assert.equal(grow([30, 10, 20]).height, 2, 'a level between two lower ones');
  assert.equal(grow([10, 30, 20]).height, 2, 'a level between two higher ones');
  assert.equal(grow([30, 20, 10]).height, 2, 'falling levels');
  assert.equal(grow([10, 20, 30]).height, 2, 'rising levels');

  const ringSize = 500;
  let root = null;
  const held = [];
  for (let i = 5000; i > 0; i--) {
    const meanSquare = 1e-3 * (1 + i * 1e-6);
    root = insertTreeValue(root, meanSquare);
    held.push(meanSquare);
    if (held.length > ringSize) root = removeTreeValue(root, held.shift());
  }
  assert.ok(root.height <= Math.ceil(1.44 * Math.log2(ringSize + 2)),
    `a falling level leaves the index balanced (height ${root.height})`);
});

test('the index counts repeated levels and sums at or above a threshold', () => {
  const { insertTreeValue, removeTreeValue, treeCount, treeSum, treeValuesAtOrAbove } = gateIndex();
  let root = null;
  for (const v of [5, 3, 8, 3, 3, 9, 1, 8]) root = insertTreeValue(root, v);
  assert.equal(treeCount(root), 8);
  assert.equal(treeSum(root), 40);
  assert.deepEqual(treeValuesAtOrAbove(root, 3), { sum: 39, count: 7 });
  assert.deepEqual(treeValuesAtOrAbove(root, 4), { sum: 30, count: 4 });
  assert.deepEqual(treeValuesAtOrAbove(root, 10), { sum: 0, count: 0 });
  root = removeTreeValue(root, 3);
  assert.equal(treeCount(root), 7, 'one of a repeated level goes');
  assert.deepEqual(treeValuesAtOrAbove(root, 3), { sum: 36, count: 6 });
  root = removeTreeValue(root, 5);
  root = removeTreeValue(root, 8);
  root = removeTreeValue(root, 1);
  assert.equal(treeCount(root), 4);
  assert.deepEqual(treeValuesAtOrAbove(root, 0), { sum: 23, count: 4 });
  assert.equal(removeTreeValue(null, 1), null);
});
