// common.test.cjs — core/common.js, what the extensions load ahead of their
// own scripts: the settings key, the settings read, move and write, the serial
// queue, the stored map writer, the Target LUFS default and range, the gain
// range, the runtime check, gain conversion and display (Auto's included), the
// gain for a level, the gain a write may store, the stored gain per type, a
// row's name, label and Auto flags, the worker's write listener and a page's
// request to it, the slider keys, the catalog lookup, the HTML escape, the
// pages' wording and language, a page's reveal and first load, the gain as one
// text, the popup's cards, the settings page's error line and its sliders'
// gestures, the popup's asking again for the state, its owner line, whether
// its tab is on the site, its status line and its display unit.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { shared } = require('./helpers.cjs');

const SOURCE = fs.readFileSync(shared('core', 'common.js'), 'utf8');

// The file run as the extensions run it, a classic script, in a context of
// its own holding what the case gives it.
function load(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(SOURCE, context, { filename: 'core/common.js' });
  return context;
}

// An element whose innerHTML serialises its text the way a browser serialises
// a text node: &, < and > (and a no-break space) as references, quotes as they
// are.
const DOCUMENT = {
  createElement: () => ({
    textContent: '',
    get innerHTML() {
      return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    }
  })
};

test('the settings key, the Target LUFS default and range and the gain range are the extensions\' values', () => {
  const c = load();
  assert.equal(vm.runInContext('SETTINGS_KEY', c), 'autoLoudnessSettings');
  assert.equal(vm.runInContext('DEFAULT_TARGET_LUFS', c), -18);
  assert.equal(vm.runInContext('MIN_TARGET_LUFS', c), -30);
  assert.equal(vm.runInContext('MAX_TARGET_LUFS', c), -6);
  assert.equal(vm.runInContext('MIN_GAIN', c), 0);
  assert.equal(vm.runInContext('MAX_GAIN', c), 6);
});

// chrome.storage with the two areas a case gives, each answering get with the
// keys it holds and logging the area read.
function settingsAreas({ sync = {}, local = {} } = {}) {
  const reads = [];
  const area = (name, held) => ({
    async get(key) {
      reads.push(name);
      return Object.prototype.hasOwnProperty.call(held, key) ? { [key]: held[key] } : {};
    }
  });
  return { reads, storage: { sync: area('sync', sync), local: area('local', local) } };
}

test('the settings are read from sync, and from local only where sync holds none', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  const fromSync = settingsAreas({ sync: { [KEY]: { targetLufs: -20 } }, local: { [KEY]: { targetLufs: -24 } } });
  assert.equal(JSON.stringify(await c.readSettings(fromSync.storage)), '{"targetLufs":-20}');
  assert.deepEqual(fromSync.reads, ['sync'], 'a copy left in local is not read once sync answers');

  // A profile whose settings the worker has not moved yet.
  const notMoved = settingsAreas({ local: { [KEY]: { targetLufs: -24 } } });
  assert.equal(JSON.stringify(await c.readSettings(notMoved.storage)), '{"targetLufs":-24}');
  assert.deepEqual(notMoved.reads, ['sync', 'local']);

  // A value in sync that is no settings object does not hide the copy in local.
  for (const value of [null, 'loud', 3, true, ['targetLufs']]) {
    const unusable = settingsAreas({ sync: { [KEY]: value }, local: { [KEY]: { targetLufs: -24 } } });
    assert.equal(JSON.stringify(await c.readSettings(unusable.storage)), '{"targetLufs":-24}', `sync holding ${JSON.stringify(value)}`);
  }

  for (const local of [{}, { [KEY]: 'loud' }, { [KEY]: [] }]) {
    const neither = settingsAreas({ local });
    assert.equal(JSON.stringify(await c.readSettings(neither.storage)), '{}', `local holding ${JSON.stringify(local[KEY])}`);
    assert.deepEqual(neither.reads, ['sync', 'local', 'sync']);
  }

  const asked = [];
  const named = settingsAreas({ sync: { other: { targetLufs: -10 } } });
  const get = named.storage.sync.get;
  named.storage.sync.get = (key) => { asked.push(key); return get(key); };
  assert.equal(JSON.stringify(await c.readSettings(named.storage, 'other')), '{"targetLufs":-10}', 'under the key given');
  assert.deepEqual(asked, ['other']);
});

test('readSettings reads chrome.storage under SETTINGS_KEY where it is given neither', async () => {
  const { storage, reads } = settingsAreas({ local: { autoLoudnessSettings: { displayUnit: 'dB' } } });
  const c = load({ chrome: { storage } });
  assert.equal(JSON.stringify(await c.readSettings()), '{"displayUnit":"dB"}');
  assert.deepEqual(reads, ['sync', 'local']);
});

test('a settings read made across the move answers with what the move put in sync', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  // Sync is read empty; the move then writes sync and clears local before the
  // local read is made, so local is empty too. The settings are in sync by then.
  const moved = { targetLufs: -24, adGainDb: -12 };
  const across = settingsAreas({ local: { [KEY]: moved } });
  across.storage.local.get = async () => {
    across.storage.sync = settingsAreas({ sync: { [KEY]: moved } }).storage.sync;
    return {};
  };
  assert.equal(await c.readSettings(across.storage), moved);
});

// chrome.storage holding what a case gives, logging every call.
function storageFor({ sync = {}, local = {} } = {}) {
  const held = { sync: { ...sync }, local: { ...local } };
  const calls = [];
  const area = (name) => ({
    async get(key) {
      calls.push(`${name}.get`);
      return Object.prototype.hasOwnProperty.call(held[name], key) ? { [key]: held[name][key] } : {};
    },
    async set(items) { calls.push(`${name}.set`); Object.assign(held[name], items); },
    async remove(key) { calls.push(`${name}.remove`); delete held[name][key]; }
  });
  return { held, calls, storage: { sync: area('sync'), local: area('local') } };
}

test('moveSettingsToSync moves a settings object from local to sync, and clears local', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  const fresh = storageFor({ local: { [KEY]: { targetLufs: -24 } } });
  assert.equal(await c.moveSettingsToSync(fresh.storage), true);
  assert.equal(JSON.stringify(fresh.held), '{"sync":{"autoLoudnessSettings":{"targetLufs":-24}},"local":{}}');
  assert.deepEqual(fresh.calls, ['local.get', 'sync.get', 'sync.set', 'local.remove'], 'sync is written before local is cleared');

  const synced = storageFor({ sync: { [KEY]: { targetLufs: -20 } }, local: { [KEY]: { targetLufs: -24 } } });
  assert.equal(await c.moveSettingsToSync(synced.storage), true);
  assert.equal(JSON.stringify(synced.held), '{"sync":{"autoLoudnessSettings":{"targetLufs":-20}},"local":{}}', 'what sync holds stays');

  for (const value of [null, 'loud', 3, ['targetLufs']]) {
    const unusable = storageFor({ local: { [KEY]: value } });
    assert.equal(await c.moveSettingsToSync(unusable.storage), true);
    assert.equal(JSON.stringify(unusable.held), '{"sync":{},"local":{}}', `local holding ${JSON.stringify(value)} is cleared, not moved`);
  }
  const overUnusable = storageFor({ sync: { [KEY]: 'loud' }, local: { [KEY]: { targetLufs: -24 } } });
  await c.moveSettingsToSync(overUnusable.storage);
  assert.equal(JSON.stringify(overUnusable.held.sync), '{"autoLoudnessSettings":{"targetLufs":-24}}', 'over a value in sync that is no settings object');

  const none = storageFor({ sync: { [KEY]: { targetLufs: -20 } } });
  assert.equal(await c.moveSettingsToSync(none.storage), false);
  assert.deepEqual(none.calls, ['local.get'], 'one read where local holds nothing');
});

test('moveSettingsToSync clears local only once sync is written, and answers a failure as its own', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  const slow = storageFor({ local: { [KEY]: { targetLufs: -24 } } });
  let land, asked;
  const reached = new Promise((resolve) => { asked = resolve; });
  const set = slow.storage.sync.set;
  slow.storage.sync.set = (items) => new Promise((resolve) => { land = () => resolve(set(items)); asked(); });
  const moving = c.moveSettingsToSync(slow.storage);
  await reached;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(slow.calls, ['local.get', 'sync.get'], 'local is not cleared while the sync write is out');
  land();
  assert.equal(await moving, true);
  assert.deepEqual(slow.calls, ['local.get', 'sync.get', 'sync.set', 'local.remove']);

  const refused = storageFor({ local: { [KEY]: { targetLufs: -24 } } });
  refused.storage.sync.set = async () => { throw new Error('sync quota'); };
  await assert.rejects(c.moveSettingsToSync(refused.storage), /sync quota/);
  assert.equal(JSON.stringify(refused.held.local), '{"autoLoudnessSettings":{"targetLufs":-24}}', 'a failed sync write leaves local as it was');

  const stuck = storageFor({ local: { [KEY]: { targetLufs: -24 } } });
  stuck.storage.local.remove = async () => { throw new Error('local refused'); };
  await assert.rejects(c.moveSettingsToSync(stuck.storage), /local refused/);
});

test('moveSettingsToSync writes what keep gives, under the key given, and reads chrome.storage by default', async () => {
  const c = load();
  const kept = storageFor({ local: { other: { targetLufs: -24, dropped: true } } });
  const asked = [];
  const keep = (settings) => { asked.push(settings); const { dropped, ...rest } = settings; return rest; };
  assert.equal(await c.moveSettingsToSync(kept.storage, 'other', keep), true);
  assert.equal(JSON.stringify(kept.held), '{"sync":{"other":{"targetLufs":-24}},"local":{}}');
  assert.equal(asked.length, 1);

  const byDefault = storageFor({ local: { autoLoudnessSettings: { displayUnit: 'dB' } } });
  const d = load({ chrome: { storage: byDefault.storage } });
  assert.equal(await d.moveSettingsToSync(), true);
  assert.equal(JSON.stringify(byDefault.held.sync), '{"autoLoudnessSettings":{"displayUnit":"dB"}}');
});

test('settingCheck gives a table\'s own check, and nothing for any other name', () => {
  const c = load();
  const checks = { displayUnit: (value) => value === '%' || value === 'dB' };
  assert.equal(c.settingCheck(checks, 'displayUnit'), checks.displayUnit);
  for (const field of ['targetLufs', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '']) {
    assert.equal(c.settingCheck(checks, field), null, field);
  }
});

test('sameStoredSettings compares field for field', () => {
  const c = load();
  assert.equal(c.sameStoredSettings({ a: 1, b: '%' }, { b: '%', a: 1 }), true);
  assert.equal(c.sameStoredSettings({}, {}), true);
  assert.equal(c.sameStoredSettings({ a: 1 }, { a: 2 }), false);
  assert.equal(c.sameStoredSettings({ a: 1 }, { a: 1, b: 2 }), false, 'a field stored and not written');
  assert.equal(c.sameStoredSettings({ a: 1, b: 2 }, { a: 1 }), false, 'a field written and not stored');
  assert.equal(c.sameStoredSettings({ a: undefined }, { b: 1 }), false, 'the same count of other fields');
  for (const stored of [undefined, null, 'x', [], 1]) {
    assert.equal(c.sameStoredSettings({}, stored), false, JSON.stringify(stored) ?? 'undefined');
  }
});

test('writeSettingsChange writes the change of the settings read, and leaves out a write sync holds already', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  const set = (field, value) => (settings) => ({ ...settings, [field]: value });
  const fresh = storageFor({ sync: { [KEY]: { targetLufs: -18, displayUnit: '%' } } });
  assert.equal(JSON.stringify(await c.writeSettingsChange(set('displayUnit', 'dB'), fresh.storage)), '{"targetLufs":-18,"displayUnit":"dB"}');
  assert.equal(JSON.stringify(fresh.held.sync), '{"autoLoudnessSettings":{"targetLufs":-18,"displayUnit":"dB"}}');

  const same = storageFor({ sync: { [KEY]: { targetLufs: -18, displayUnit: '%' } } });
  assert.equal(JSON.stringify(await c.writeSettingsChange(set('displayUnit', '%'), same.storage)), '{"targetLufs":-18,"displayUnit":"%"}');
  assert.deepEqual(same.calls.filter((call) => call.endsWith('.set')), [], 'what sync holds already is not written again');

  // A profile the worker has not moved yet: the write carries local's settings into sync.
  const unmoved = storageFor({ local: { [KEY]: { targetLufs: -24, displayUnit: '%' } } });
  await c.writeSettingsChange(set('displayUnit', '%'), unmoved.storage);
  assert.equal(JSON.stringify(unmoved.held.sync), '{"autoLoudnessSettings":{"targetLufs":-24,"displayUnit":"%"}}', 'a write equal to local\'s copy is still made into sync');

  const none = storageFor();
  await c.writeSettingsChange(set('targetLufs', -20), none.storage);
  assert.equal(JSON.stringify(none.held.sync), '{"autoLoudnessSettings":{"targetLufs":-20}}');

  // The change gets a copy: changing it in place does not make the read match.
  const inPlace = storageFor({ sync: { other: { displayUnit: '%', dropped: true } } });
  const drop = (settings) => { delete settings.dropped; return settings; };
  assert.equal(JSON.stringify(await c.writeSettingsChange(drop, inPlace.storage, 'other')), '{"displayUnit":"%"}');
  assert.equal(JSON.stringify(inPlace.held.sync), '{"other":{"displayUnit":"%"}}', 'what the change drops is written away');

  const thrown = storageFor({ sync: { [KEY]: { targetLufs: -18 } } });
  await assert.rejects(c.writeSettingsChange(() => { throw new TypeError('not a setting'); }, thrown.storage), /not a setting/);
  assert.deepEqual(thrown.calls, ['sync.get'], 'a change that throws writes nothing');

  const refused = storageFor();
  refused.storage.sync.set = async () => { throw new Error('sync quota'); };
  await assert.rejects(c.writeSettingsChange(set('targetLufs', -20), refused.storage), /sync quota/);

  const byDefault = storageFor();
  const d = load({ chrome: { storage: byDefault.storage } });
  await d.writeSettingsChange(set('displayUnit', 'dB'));
  assert.equal(JSON.stringify(byDefault.held.sync), '{"autoLoudnessSettings":{"displayUnit":"dB"}}');
});

test('a settings change that changes nothing does not write back over settings sync takes meanwhile', async () => {
  const c = load();
  const KEY = 'autoLoudnessSettings';
  const set = (field, value) => (settings) => ({ ...settings, [field]: value });
  // Another Chrome's change reaches sync between the read and the check that
  // follows it. A change that leaves the read as it was has nothing to write.
  for (const [field, value, theirs] of [['displayUnit', '%', { targetLufs: -24 }], ['showGainOverlay', false, { showGainOverlay: true }]]) {
    const raced = storageFor({ sync: { [KEY]: { targetLufs: -18, displayUnit: '%', showGainOverlay: false } } });
    const get = raced.storage.sync.get;
    let reads = 0;
    raced.storage.sync.get = async (key) => {
      reads += 1;
      if (reads === 2) raced.held.sync[KEY] = { ...raced.held.sync[KEY], ...theirs };
      return get(key);
    };
    await c.writeSettingsChange(set(field, value), raced.storage);
    assert.deepEqual(raced.calls.filter((call) => call.endsWith('.set')), [], `${field}: nothing is written`);
    assert.equal(JSON.stringify(raced.held.sync[KEY]), JSON.stringify({ targetLufs: -18, displayUnit: '%', showGainOverlay: false, ...theirs }), `${field}: sync keeps what it took`);
  }
});

test('tableWrite gives the own write a type names after the prefix, and null otherwise', () => {
  const c = load();
  const table = { save: () => 'saved' };
  assert.equal(c.tableWrite(table, 'store:', 'store:save'), table.save);
  for (const type of ['store:toString', 'store:', 'save', 'other:save', undefined, null, 5, ['store:save']]) {
    assert.equal(c.tableWrite(table, 'store:', type), null, JSON.stringify(type));
  }
});

test('WriteRefused names its rejection invalid-mutation', () => {
  const c = load();
  const err = vm.runInContext('new WriteRefused("not a channel")', c);
  assert.equal(err.reason, 'invalid-mutation');
  assert.equal(err.message, 'not a channel');
  assert.equal(err.name, 'WriteRefused');
  assert.equal(vm.runInContext('new WriteRefused("x") instanceof Error', c), true);
});

test('createWriteListener answers a write with ok and its result, and a rejection with its reason', async () => {
  const logged = [];
  const console = {
    warn: (...args) => logged.push(['warn', ...args.map(String)]),
    error: (...args) => logged.push(['error', String(args[0])])
  };
  const c = load({ console });
  const writes = {
    save: async () => ({ settings: { a: 1 } }),
    plain: async () => undefined,
    refused: () => { throw vm.runInContext('new WriteRefused("no")', c); },
    blocked: async () => { throw Object.assign(new Error('cycle'), { reason: 'stored-state-invalid' }); },
    broken: async () => { throw new Error('quota'); }
  };
  const listener = c.createWriteListener({
    prefix: '[T]',
    ignoredTypes: ['stateChanged'],
    route: (msg) => (writes[msg?.type] ? { write: writes[msg.type], label: msg.type + ' write', failed: 'storage-update-failed' } : null)
  });
  // The answer is made in the context's realm, so it is compared as JSON.
  const ask = (msg) => new Promise((resolve) => {
    const kept = listener(msg, {}, (answer) => resolve(JSON.parse(JSON.stringify(answer))));
    if (kept !== true) resolve({ kept });
  });
  assert.deepEqual(await ask({ type: 'save' }), { ok: true, settings: { a: 1 } });
  assert.deepEqual(await ask({ type: 'plain' }), { ok: true });
  assert.deepEqual(await ask({ type: 'refused' }), { ok: false, reason: 'invalid-mutation' });
  assert.deepEqual(await ask({ type: 'blocked' }), { ok: false, reason: 'stored-state-invalid' });
  assert.deepEqual(await ask({ type: 'broken' }), { ok: false, reason: 'storage-update-failed' });
  assert.deepEqual(logged, [
    ['error', '[T] refused write rejected as invalid'],
    ['error', '[T] blocked write blocked by the stored state'],
    ['error', '[T] broken write failed']
  ]);
  logged.length = 0;
  const unanswered = () => assert.fail('a message that asks for no write is answered');
  assert.equal(listener({ type: 'stateChanged' }, {}, unanswered), false, 'an ignored type is left unanswered');
  assert.deepEqual(logged, [], 'and not logged');
  assert.equal(listener({ type: 'other' }, {}, unanswered), false);
  assert.equal(listener(null, {}, unanswered), false);
  assert.deepEqual(logged, [['warn', '[T] unknown message type', 'other'], ['warn', '[T] unknown message type', 'undefined']]);
});

test('requestWrite resolves with the worker\'s answer when it is ok, and rejects with the reason it answered otherwise', async () => {
  const sent = [];
  let answer;
  const c = load({ chrome: { runtime: { sendMessage: async (message) => { sent.push(message); return answer; } } } });
  const message = { type: 'store:deleteChannel', key: 'UC1' };
  answer = { ok: true, settings: {} };
  assert.equal(await c.requestWrite(message), answer);
  assert.equal(sent[0], message, 'the message goes to the worker as it is');
  answer = { ok: false, reason: 'invalid-mutation' };
  await assert.rejects(c.requestWrite(message), { message: 'invalid-mutation' });
  for (const unanswered of [undefined, { ok: false }, {}]) {
    answer = unanswered;
    await assert.rejects(c.requestWrite(message), { message: 'write not confirmed' }, JSON.stringify(unanswered));
  }
  const gone = load({ chrome: { runtime: { sendMessage: () => { throw new Error('Extension context invalidated.'); } } } });
  await assert.rejects(gone.requestWrite(message), { message: 'Extension context invalidated.' },
    'a send that throws is a rejection, not a throw');
});

test('createStoredMapWriter writes a changed map back, one write after the other', async () => {
  const { held, calls, storage } = storageFor({ local: { channels: { a: 1 } } });
  const c = load({ chrome: { runtime: { id: 'x' }, storage } });
  const write = c.createStoredMapWriter('channels');
  await Promise.all([
    write((map) => { map.b = 2; }),
    write((map) => { map.c = map.b + 1; })
  ]);
  assert.equal(JSON.stringify(held.local.channels), '{"a":1,"b":2,"c":3}', 'the second write reads what the first left');

  calls.length = 0;
  await write((map) => { map.a = 1; });
  assert.deepEqual(calls, ['local.get'], 'a map mutate leaves as it was is not written');
  await write(() => {}, { marker: true });
  assert.equal(JSON.stringify(held.local), '{"channels":{"a":1,"b":2,"c":3},"marker":true}', 'extra keys are written whatever mutate did');

  const empty = storageFor();
  const e = load({ chrome: { runtime: { id: 'x' }, storage: empty.storage } });
  await e.createStoredMapWriter('channels')((map) => { map.first = true; });
  assert.equal(JSON.stringify(empty.held.local), '{"channels":{"first":true}}', 'a map not stored yet starts empty');

  const failing = c.createStoredMapWriter('channels');
  await assert.rejects(failing(() => { throw new Error('bad mutate'); }), /bad mutate/);
  await failing((map) => { map.d = 4; });
  assert.equal(held.local.channels.d, 4, 'a failed write does not stop the next');
});

test('createStoredMapWriter starts a write once the set before it has landed, and answers a failed set', async () => {
  const slow = storageFor({ local: { channels: {} } });
  const set = slow.storage.local.set;
  let land;
  slow.storage.local.set = (items) => new Promise((resolve) => { land = () => resolve(set(items)); });
  const c = load({ chrome: { runtime: { id: 'x' }, storage: slow.storage } });
  const write = c.createStoredMapWriter('channels');
  const first = write((map) => { map.a = 1; });
  let secondSaw;
  const second = write((map) => { secondSaw = JSON.stringify(map); map.b = 2; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(secondSaw, undefined, 'the next write waits while a set is out');
  land();
  await first;
  for (let i = 0; i < 10; i++) await Promise.resolve();
  land();
  await second;
  assert.equal(secondSaw, '{"a":1}', 'and reads what that set left');

  const refused = storageFor({ local: { channels: {} } });
  refused.storage.local.set = async () => { throw new Error('local quota'); };
  const d = load({ chrome: { runtime: { id: 'x' }, storage: refused.storage } });
  await assert.rejects(d.createStoredMapWriter('channels')((map) => { map.a = 1; }), /local quota/);
});

test('createStoredMapWriter writes nothing where the runtime cannot be reached', async () => {
  const { calls, storage } = storageFor({ local: { channels: { a: 1 } } });
  const c = load({ chrome: { runtime: {}, storage } });
  let ran = false;
  await c.createStoredMapWriter('channels')(() => { ran = true; });
  assert.equal(ran, false, 'mutate never runs');
  assert.deepEqual(calls, [], 'and storage is not read');
});

test('createSerialQueue runs work one after the other, past a failure, answering as each settles', async () => {
  const c = load();
  const queue = c.createSerialQueue();
  const order = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = queue(async () => { order.push('first starts'); await held; order.push('first ends'); return 1; });
  const second = queue(async () => { order.push('second'); throw new Error('second failed'); });
  const third = queue(() => { order.push('third'); return 3; });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['first starts'], 'the next waits while one is under way');
  release();
  assert.equal(await first, 1);
  await assert.rejects(second, /second failed/);
  assert.equal(await third, 3, 'a failure does not stop the queue');
  assert.deepEqual(order, ['first starts', 'first ends', 'second', 'third']);

  const other = c.createSerialQueue();
  let otherRan = false;
  const blocked = queue(() => new Promise(() => {}));
  await other(() => { otherRan = true; });
  assert.equal(otherRan, true, 'each queue runs apart');
  void blocked;
});

test('isContextValid answers whether the runtime can still be reached', () => {
  assert.equal(load({ chrome: { runtime: { id: 'abc' } } }).isContextValid(), true);
  assert.equal(load({ chrome: { runtime: {} } }).isContextValid(), false, 'a runtime with no id, as after a reload');
  assert.equal(load({ chrome: {} }).isContextValid(), false, 'no runtime at all');
  assert.equal(load().isContextValid(), false, 'no chrome at all');
  const throwing = { get runtime() { throw new Error('Extension context invalidated.'); } };
  assert.equal(load({ chrome: throwing }).isContextValid(), false, 'a runtime that throws when asked for');
});

test('gains turn into percent and dB, and percent back into a gain', () => {
  const c = load();
  assert.equal(c.gainToPercent(1), 100);
  assert.equal(c.gainToPercent(0.634), 63);
  assert.equal(c.gainToPercent(0.635), 64, 'rounded to the nearest percent');
  assert.equal(c.gainToPercent(6), 600);
  assert.equal(c.percentToGain(63), 0.63);
  assert.equal(c.percentToGain(0), 0);
  assert.equal(c.gainToDb(1), '0.0');
  assert.equal(c.gainToDb(2), '6.0');
  assert.equal(c.gainToDb(0.5), '-6.0');
  assert.equal(c.gainToDb(0), '-Inf', 'silence has no level in dB');
  assert.equal(c.gainToDb(-1), '-Inf');
});

test('gainForLevel takes a level to the target, within the gain range', () => {
  const c = load();
  assert.equal(c.gainForLevel(-18, -18), 1, 'a level at the target keeps it');
  assert.ok(Math.abs(c.gainForLevel(-24, -18) - Math.pow(10, 6 / 20)) < 1e-12, 'a quieter level is raised');
  assert.ok(Math.abs(c.gainForLevel(-12, -18) - Math.pow(10, -6 / 20)) < 1e-12, 'a louder one lowered');
  assert.equal(c.gainForLevel(-70, -18), 6, 'no higher than MAX_GAIN');
  assert.equal(c.gainForLevel(Infinity, -18), 0, 'no lower than MIN_GAIN');
  assert.equal(c.gainForLevel(-Infinity, -18), 1, 'a gain that is not finite is 1');
  for (const [level, target] of [[NaN, -18], [-18, NaN], [-18, Infinity], [undefined, -18], ['x', -18]]) {
    assert.equal(c.gainForLevel(level, target), 1, `${String(level)} to ${String(target)}`);
  }
  assert.equal(c.gainForLevel(-18, -Infinity), 0, 'a target of -Infinity asks for silence');
  assert.ok(Math.abs(c.gainForLevel(null, -18) - Math.pow(10, -18 / 20)) < 1e-12, 'null counts as 0, as the arithmetic has it');
});

test('isStorableGain takes a finite gain within the range, and clampGain holds one to it', () => {
  const c = load();
  for (const gain of [0, 0.5, 1, 6]) assert.equal(c.isStorableGain(gain), true, String(gain));
  for (const gain of [-0.01, 6.01, 7, -1, NaN, Infinity, -Infinity, null, undefined, '1', true, [], {}]) {
    assert.equal(c.isStorableGain(gain), false, String(gain));
  }
  assert.equal(c.clampGain(7.5), 6);
  assert.equal(c.clampGain(-1), 0);
  assert.equal(c.clampGain(2.5), 2.5);
  assert.equal(c.clampGain(6), 6);
  assert.equal(c.clampGain(0), 0);
});

test('storedGain reads a slot, and the single gain of the earlier form only where no slot is a key', () => {
  const c = load();
  const SLOTS = ['gainLive', 'gainVideo'];
  const read = (entry) => [c.storedGain(entry, 'gainVideo', SLOTS), c.storedGain(entry, 'gainLive', SLOTS)];
  assert.deepEqual(read({ gainVideo: 1.5, gainLive: 0.5 }), [1.5, 0.5]);
  assert.deepEqual(read({ gain: 2 }), [2, 2], 'the earlier form, for every type');
  assert.deepEqual(read({ gain: 2, gainLive: 1 }), [null, 1], 'beside a slot, the earlier gain is not read');
  assert.deepEqual(read({ gainVideo: null, gain: 3 }), [null, null], 'a slot that is a key, though empty, is enough');
  assert.deepEqual(read({ gainVideo: 0 }), [0, null], 'a stored silence is a gain');
  for (const value of ['x', '1.5', NaN, Infinity, -Infinity, true, [], {}]) {
    assert.deepEqual(read({ gainVideo: value }), [null, null], `a slot holding ${String(value)}`);
    assert.deepEqual(read({ gain: value }), [null, null], `the earlier gain ${String(value)}`);
  }
  for (const entry of [undefined, null, 'x', 3]) assert.deepEqual(read(entry), [null, null], `entry ${String(entry)}`);
  const inherited = Object.assign(Object.create({ gainVideo: 9 }), { gain: 2 });
  assert.deepEqual(read(inherited), [2, 2], 'a slot only on the prototype is no slot');
});

test('expandLegacyGain gives every slot the earlier single gain where none is a key, and removes it', () => {
  const c = load();
  const SLOTS = ['gainLive', 'gainVod'];
  const expand = (entry) => JSON.stringify(c.expandLegacyGain(entry, SLOTS));
  assert.equal(expand({ gain: 2, name: 'a' }), '{"name":"a","gainLive":2,"gainVod":2}');
  assert.equal(expand({ gain: 2, gainLive: 1 }), '{"gainLive":1}', 'beside a slot it is only removed');
  assert.equal(expand({ gain: 2, gainVod: null }), '{"gainVod":null}', 'a slot that is a key, though empty, is enough');
  assert.equal(expand({ gain: 'x' }), '{}', 'one that is no finite number is only removed');
  assert.equal(expand({ gainLive: 1 }), '{"gainLive":1}', 'an entry without it is left as it is');
  const entry = { gain: 1 };
  assert.equal(c.expandLegacyGain(entry, SLOTS), entry, 'in place');
});

test('isRowKey takes non-empty text alone', () => {
  const c = load();
  for (const key of ['UC1', 'channel:ch7', 'login:x', ' ', 'undefined']) assert.equal(c.isRowKey(key), true, JSON.stringify(key));
  for (const key of ['', undefined, null, 5, true, ['UC1'], { key: 'UC1' }]) assert.equal(c.isRowKey(key), false, JSON.stringify(key));
});

test('rowLabel is a row\'s name where it is non-empty text, and its key otherwise', () => {
  const c = load();
  assert.equal(c.rowLabel('UC1', { name: 'Real' }), 'Real');
  for (const name of ['', undefined, null, 5, ['Real'], { name: 'Real' }]) {
    assert.equal(c.rowLabel('UC1', { name }), 'UC1', JSON.stringify(name));
  }
  assert.equal(c.rowLabel('user:4', {}), 'user:4', 'a row with no name');
});

test('applyEntryName names a row from text other than its id, and a nameless row by its id where asked', () => {
  const c = load();
  const named = (entry, name, nameNewRow) => { c.applyEntryName(entry, 'UC1', name, nameNewRow); return entry.name; };
  assert.equal(named({}, 'Real'), 'Real');
  assert.equal(named({ name: 'Old' }, 'New'), 'New', 'a new name replaces the stored one');
  assert.equal(named({ name: 'Real' }, 'UC1'), 'Real', 'the id does not replace a stored name');
  for (const name of [undefined, null, '', 5, true, ['x'], { x: 1 }]) {
    assert.equal(named({ name: 'Real' }, name), 'Real', `${JSON.stringify(name)} leaves the stored name`);
    assert.equal(named({}, name), 'UC1', `${JSON.stringify(name)} names a nameless row by its id`);
    assert.equal(named({}, name, false), undefined, `or leaves it nameless where asked (${JSON.stringify(name)})`);
  }
  assert.equal(named({}, 'UC1'), 'UC1', 'the id itself names a nameless row');
  assert.equal(named({}, 'UC1', false), undefined);
  assert.equal(named({}, 'Real', false), 'Real', 'a name is taken whatever nameNewRow says');
});

test('expandLegacyAutoFlag gives each type with no flag of its own the earlier flag, and removes it', () => {
  const c = load();
  const FIELDS = ['autoApplyLoudnessLive', 'autoApplyLoudnessVideo'];
  const expand = (entry) => JSON.stringify(c.expandLegacyAutoFlag(entry, FIELDS));
  assert.equal(expand({ autoApplyLoudness: true }), '{"autoApplyLoudnessLive":true,"autoApplyLoudnessVideo":true}');
  assert.equal(expand({ autoApplyLoudness: true, autoApplyLoudnessLive: false }), '{"autoApplyLoudnessLive":false,"autoApplyLoudnessVideo":true}', 'a flag of its own stays');
  assert.equal(expand({ autoApplyLoudness: 0 }), '{"autoApplyLoudnessLive":false,"autoApplyLoudnessVideo":false}', 'as a boolean');
  assert.equal(expand({ autoApplyLoudnessLive: true }), '{"autoApplyLoudnessLive":true}', 'an entry without it is left as it is');
  const entry = { autoApplyLoudness: false };
  assert.equal(c.expandLegacyAutoFlag(entry, FIELDS), entry, 'in place');
});

test('autoFlagFor reads the type\'s flag, then the earlier one, then the stored-gain rule, then the default', () => {
  const c = load();
  const F = 'autoApplyLoudnessLive';
  assert.equal(c.autoFlagFor({ [F]: false, autoApplyLoudness: true }, F, true, false), false, 'the type\'s own flag first');
  assert.equal(c.autoFlagFor({ autoApplyLoudness: true }, F, false, true), true, 'then the earlier flag for every type');
  assert.equal(c.autoFlagFor({}, F, true, true), false, 'then off where a stored gain turns it off');
  assert.equal(c.autoFlagFor({}, F, true, false), true, 'then the default');
  assert.equal(c.autoFlagFor({}, F, 0, false), false, 'as a boolean');
  for (const entry of [null, undefined, 'x']) assert.equal(c.autoFlagFor(entry, F, true, true), true, `entry ${String(entry)}`);
  const inherited = Object.create({ [F]: false });
  assert.equal(c.autoFlagFor(inherited, F, true, false), true, 'a flag only on the prototype is no flag');
});

test('formatGain shows a gain in the display unit', () => {
  const c = load();
  assert.deepEqual({ ...c.formatGain(0.5, 'dB') }, { text: '-6.0', unit: ' dB' });
  assert.deepEqual({ ...c.formatGain(0.5, '%') }, { text: '50', unit: '%' });
  assert.deepEqual({ ...c.formatGain(0.5, undefined) }, { text: '50', unit: '%' }, 'percent where no unit is set');
});

test('formatAutoGain shows the stored Auto gain, and a dash where none is stored', () => {
  const c = load();
  assert.equal(c.formatAutoGain(0.7, '%'), 'Auto (70%)');
  assert.equal(c.formatAutoGain(0.5, 'dB', '自動'), '自動 (-6.0 dB)', 'in the display unit, under the label given');
  assert.equal(c.formatAutoGain(0, '%'), 'Auto (0%)', 'a stored silence is a gain');
  for (const none of [null, undefined, NaN, Infinity, -Infinity, '0.5']) {
    assert.equal(c.formatAutoGain(none, '%'), 'Auto (—)', `no gain to show: ${String(none)}`);
    assert.equal(c.formatAutoGain(none, 'dB'), 'Auto (—)');
  }
});

test('the slider keys are the eight that move a range input\'s value', () => {
  const c = load();
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  assert.deepEqual(vm.runInContext('[...SLIDER_VALUE_KEYS].join(",")', c), keys.join(','));
  for (const key of keys) assert.equal(c.isSliderMoveKey(key), true, key);
  for (const key of ['Tab', 'Shift', 'Enter', ' ', 'a', 'arrowleft', '', undefined]) {
    assert.equal(c.isSliderMoveKey(key), false, String(key));
  }
});

test('createSliderKeys begins a hold at the first value key down and ends it at the last let go of', () => {
  const c = load();
  const down = (key, repeat = false) => ({ key, repeat });
  const keys = c.createSliderKeys();
  assert.equal(keys.press(down('Tab')), false, 'another key takes no part');
  assert.equal(keys.release(down('Tab')), false);
  assert.equal(keys.press(down('ArrowRight', true)), false, 'a repeat begins nothing');
  assert.equal(keys.release(down('ArrowRight')), false, 'nor did it count the key as down');
  assert.equal(keys.press(down('ArrowRight')), true, 'the first value key down begins the hold');
  assert.equal(keys.press(down('ArrowRight', true)), false);
  assert.equal(keys.press(down('ArrowRight')), false, 'the key already down, pressed again, stays in the hold');
  assert.equal(keys.press(down('ArrowUp')), false, 'a second one joins it');
  assert.equal(keys.release(down('ArrowRight')), false, 'the hold lasts while one is down');
  assert.equal(keys.release(down('Home')), false, 'a key never down ends nothing');
  assert.equal(keys.release(down('ArrowUp')), true, 'the last one let go of ends it');
  assert.equal(keys.release(down('ArrowUp')), false);

  assert.equal(keys.press(down('PageDown')), true);
  keys.clear();
  assert.equal(keys.release(down('PageDown')), false, 'clear lets every key go without ending a hold');
  assert.equal(keys.press(down('End')), true, 'and the next value key down begins one');

  const other = c.createSliderKeys();
  assert.equal(other.press(down('End')), true, 'each tracker counts its own slider\'s keys');
});

// A settings slider and the window, each keeping its listeners, and the page
// state holdSettingsSlider is handed.
function settingsSlider({ stored = -18 } = {}) {
  const on = (target) => (type, fn) => { (target.listeners[type] ||= []).push(fn); };
  const slider = { value: String(stored), listeners: {} };
  slider.addEventListener = on(slider);
  const win = { listeners: {} };
  win.addEventListener = on(win);
  const page = { stored, label: '', saves: [] };
  const c = load({ window: win });
  const held = c.holdSettingsSlider(slider, {
    current: () => page.stored,
    drawLabel: (value) => { page.label = `${value}`; },
    save: (value) => { page.saves.push(value); page.stored = value; }
  });
  const fire = (target, type, event = {}) => {
    for (const fn of target.listeners[type] || []) fn({ target, button: 0, ...event });
  };
  const move = (value) => { slider.value = String(value); fire(slider, 'input'); };
  return { slider, win, page, held, fire: (type, event) => fire(slider, type, event), blurWindow: () => fire(win, 'blur'), move };
}

test('holdSettingsSlider writes a key hold once, at the keyup of the last value key, where it moved the value', () => {
  const s = settingsSlider();
  s.fire('keydown', { key: 'ArrowRight' });
  assert.equal(s.held(), true, 'a value key held is held');
  s.move(-17); s.fire('change');
  s.fire('keydown', { key: 'ArrowRight', repeat: true });
  s.move(-16); s.fire('change');
  assert.deepEqual([s.page.saves, s.page.label], [[], '-16'], 'the label follows and nothing is written while it is held');
  s.fire('keydown', { key: 'ArrowRight' });
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.page.saves, [-16], 'the key pressed again stays in the hold, and its keyup writes once');
  assert.equal(s.held(), false);

  s.fire('keydown', { key: 'Tab' });
  assert.equal(s.held(), false, 'another key holds nothing');
  s.fire('keydown', { key: 'ArrowLeft' });
  s.fire('keyup', { key: 'ArrowLeft' });
  assert.deepEqual([s.page.saves, s.slider.value, s.page.label], [[-16], '-16', '-16'], 'a hold that moved nothing writes nothing and draws the stored value');
});

test('holdSettingsSlider writes a drag at its change, and draws the stored value where it is let go where it began', () => {
  const s = settingsSlider();
  s.fire('pointerdown');
  assert.equal(s.held(), true, 'a press of the primary button is held');
  s.move(-20); s.move(-22);
  assert.deepEqual(s.page.saves, [], 'the drag moves the label alone');
  s.fire('change');
  s.fire('pointerup');
  assert.deepEqual([s.page.saves, s.held()], [[-22], false], 'its change writes once');

  s.page.stored = -12;
  s.fire('pointerdown');
  s.move(-20); s.move(-22);
  s.fire('pointerup');
  assert.deepEqual([s.slider.value, s.page.label, s.page.saves], ['-12', '-12', [-22]],
    'a drag let go of on the value it began on fires no change, and draws the stored value');

  for (const button of [1, 2]) {
    s.fire('pointerdown', { button });
    assert.equal(s.held(), false, `a press with button ${button} holds nothing`);
  }
});

test('holdSettingsSlider ends a gesture at a blur, writing a moved key hold, and takes nothing after it until the next press', () => {
  for (const blur of ['slider', 'window']) {
    const s = settingsSlider();
    const blurNow = () => (blur === 'window' ? s.blurWindow() : s.fire('blur'));
    s.fire('pointerdown');
    s.move(-20);
    s.fire('change');
    blurNow();
    assert.deepEqual([s.page.saves, s.held(), s.slider.value], [[-20], false, '-20'], `${blur}: the change ahead of the blur writes`);
    s.move(-25);
    assert.equal(s.page.label, '-20', `${blur}: an input after the blur moves no label`);
    s.fire('change');
    s.fire('pointerup');
    assert.deepEqual([s.page.saves, s.slider.value, s.page.label], [[-20], '-20', '-20'],
      `${blur}: what the drag does after the blur writes nothing and the thumb goes back`);
    s.fire('pointerdown');
    s.move(-21);
    s.fire('change');
    s.fire('pointerup');
    assert.deepEqual(s.page.saves, [-20, -21], `${blur}: the next press writes again`);

    s.fire('keydown', { key: 'ArrowRight' });
    s.move(-19);
    blurNow();
    assert.deepEqual([s.page.saves, s.held()], [[-20, -21, -19], false], `${blur}: a key hold that moved is written at the blur`);
    s.fire('keydown', { key: 'ArrowRight', repeat: true });
    s.move(-18);
    s.fire('change');
    s.fire('keyup', { key: 'ArrowRight' });
    assert.deepEqual(s.page.saves, [-20, -21, -19], `${blur}: and its repeats after the blur write nothing`);
    s.fire('keydown', { key: 'ArrowRight' });
    s.move(-18);
    s.fire('keyup', { key: 'ArrowRight' });
    assert.deepEqual(s.page.saves, [-20, -21, -19, -18], `${blur}: a new press writes again`);

    s.blurWindow();
    s.fire('blur');
    assert.deepEqual(s.page.saves, [-20, -21, -19, -18], `${blur}: a blur with nothing held does nothing`);
    s.move(-15);
    assert.equal(s.page.label, '-15', `${blur}: and ends no gesture, so the slider goes on answering`);
  }
});

test('holdSettingsSlider writes nothing for a drag the browser cancels, and takes nothing after it until the next press', () => {
  const s = settingsSlider();
  s.fire('pointerdown');
  s.move(-11);
  s.page.stored = -24;
  s.fire('pointercancel');
  assert.deepEqual([s.held(), s.slider.value, s.page.label, s.page.saves], [false, '-24', '-24', []],
    'the stored value is drawn and nothing is written');
  s.move(-11);
  s.fire('change');
  assert.deepEqual([s.slider.value, s.page.label, s.page.saves], ['-24', '-24', []], 'and the change Chrome fires later moves nothing');
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(-23);
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.page.saves, [-23], 'the next press writes again');

  s.fire('keydown', { key: 'ArrowRight' });
  s.move(-22);
  s.fire('pointerdown');
  s.fire('pointercancel');
  assert.equal(s.held(), true, 'a key held through a cancelled press stays held');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.page.saves, [-23, -22], 'and its keyup writes what it moved to');
});

test('holdSettingsSlider keeps a key hold through a press of the pointer, and writes what the key moved at its keyup', () => {
  const s = settingsSlider();
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(-17);
  s.fire('pointerdown');
  s.fire('pointerup');
  assert.equal(s.held(), true, 'the key is still held');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.page.saves, [-17], 'and its keyup writes what it moved to');
});

test('msg answers the catalog\'s text, or the key where there is none to give', () => {
  const asked = [];
  const chrome = {
    i18n: {
      getMessage: (key, substitutions) => {
        asked.push([key, substitutions]);
        return { known: 'Known', withValue: `Value ${substitutions}` }[key] || '';
      }
    }
  };
  const c = load({ chrome });
  assert.equal(c.msg('known'), 'Known');
  assert.equal(c.msg('withValue', '7'), 'Value 7');
  assert.deepEqual(asked[1], ['withValue', '7'], 'the substitutions are passed on');
  assert.equal(c.msg('missing'), 'missing', 'a key the catalog lacks comes back as itself');
  assert.equal(load().msg('missing'), 'missing', 'with no chrome at all');
  assert.equal(load({ chrome: {} }).msg('missing'), 'missing', 'with a chrome that has no i18n');
});

test('esc makes text safe between tags and inside a quoted attribute', () => {
  const c = load({ document: DOCUMENT });
  assert.equal(c.esc('a "b" & \'c\' <d>'), 'a &quot;b&quot; &amp; &#39;c&#39; &lt;d&gt;');
  assert.equal(c.esc('&quot;'), '&amp;quot;', 'text that looks like a reference stays text');
  assert.equal(c.esc(''), '');
});

test('applyI18n fills each data-i18n element with its message, or its key, and declares the catalog\'s language', () => {
  const element = (key) => ({ textContent: key, getAttribute: (name) => (name === 'data-i18n' ? key : null) });
  const nodes = [element('known'), element('missing')];
  const html = { lang: 'en' };
  const c = load({
    document: { documentElement: html, querySelectorAll: (selector) => (selector === '[data-i18n]' ? nodes : []) },
    chrome: { i18n: { getMessage: (key) => ({ known: 'Known', pageLanguage: 'ja' })[key] || '' } }
  });
  c.applyI18n();
  assert.deepEqual(nodes.map((node) => node.textContent), ['Known', 'missing'], 'a key the catalog lacks is shown as itself');
  assert.equal(html.lang, 'ja');
  const bare = load({ document: { documentElement: html, querySelectorAll: () => [] } });
  bare.applyI18n();
  assert.equal(html.lang, 'pageLanguage', 'a catalog with no language declares the key, as any other message');
});

test('revealPage lays the page out, then takes initializing off on the next frame', () => {
  const steps = [];
  const frames = [];
  const classes = new Set(['initializing', 'other']);
  const body = {
    get offsetWidth() { steps.push('layout'); return 0; },
    classList: { remove: (name) => { steps.push('remove ' + name); classes.delete(name); } }
  };
  const c = load({ document: { body }, requestAnimationFrame: (callback) => { steps.push('frame asked'); frames.push(callback); } });
  c.revealPage();
  assert.deepEqual(steps, ['layout', 'frame asked'], 'nothing comes off before the frame');
  assert.ok(classes.has('initializing'));
  frames.shift()();
  assert.deepEqual([...classes], ['other'], 'and only initializing comes off at it');
});

test('runPageLoad answers a load that lands, one that fails and one that never settles, and shows the page after', async () => {
  const run = (read, onLoaded = (steps) => steps.push('loaded')) => {
    const steps = [];
    const timers = new Map();
    let next = 0;
    const c = loadForPage({
      setTimeout: (fn, ms) => { timers.set(++next, { fn, ms }); return next; },
      clearTimeout: (id) => { steps.push('cleared'); timers.delete(id); }
    }, steps);
    const done = c.runPageLoad(() => read(steps), {
      onLoaded: () => onLoaded(steps),
      onFailed: (err) => steps.push('failed ' + err.message)
    });
    return { done, steps, timers };
  };
  const landed = run(async (steps) => { steps.push('read'); });
  assert.deepEqual([...landed.timers.values()].map((timer) => timer.ms), [3000], 'the deadline is armed at 3000 ms');
  await landed.done;
  assert.deepEqual(landed.steps, ['read', 'loaded', 'cleared', 'shown']);
  assert.equal(landed.timers.size, 0, 'and disarmed once it lands');

  const refused = run(async () => { throw new Error('quota'); });
  await refused.done;
  assert.deepEqual(refused.steps, ['failed quota', 'cleared', 'shown']);

  const plain = run((steps) => { steps.push('read'); });
  await plain.done;
  assert.deepEqual(plain.steps, ['read', 'loaded', 'cleared', 'shown'], 'a load that is not async lands as well');

  const broken = run(() => {}, () => { throw new Error('draw'); });
  await broken.done;
  assert.deepEqual(broken.steps, ['failed draw', 'cleared', 'shown'], 'onLoaded throwing is a failure too');

  const stuck = run(() => new Promise(() => {}));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stuck.steps, [], 'a load still out is neither answered nor shown');
  [...stuck.timers.values()][0].fn();
  await stuck.done;
  assert.deepEqual(stuck.steps, ['failed page load timed out', 'cleared', 'shown']);
});

test('formatGainText is the gain\'s number and unit in the display unit, as one text', () => {
  const c = load();
  assert.equal(c.formatGainText(1.5, '%'), '150%');
  assert.equal(c.formatGainText(2, 'dB'), '6.0 dB');
  assert.equal(c.formatGainText(0, 'dB'), '-Inf dB');
});

// core/common.js with a page that records when it is shown.
function loadForPage(globals, steps) {
  return load({
    document: { body: { offsetWidth: 0, classList: { remove: () => steps.push('shown') } } },
    requestAnimationFrame: (callback) => callback(),
    ...globals
  });
}

// An element whose text replaces every child, as a browser's does, and whose
// text reads its own and its children's in order.
function cardElement(className) {
  return {
    className,
    children: [],
    own: '',
    set textContent(value) { this.own = String(value); this.children = []; },
    get textContent() { return this.own + this.children.map((child) => child.textContent).join(''); },
    appendChild(child) { this.children.push(child); return child; }
  };
}

test('setCardValue writes a card\'s value, its unit in a span of its own, and its classes', () => {
  const c = load({ document: { createElement: (tag) => Object.assign(cardElement(''), { tag }) } });
  const card = cardElement('value current unknown');
  c.setCardValue(card, '150', '%', 'current');
  assert.equal(card.className, 'value current', 'the classes given, after value');
  assert.equal(card.own, '150');
  assert.deepEqual(card.children.map((child) => [child.tag, child.className, child.textContent]), [['span', 'unit', '%']]);
  c.setCardValue(card, '-18.0', '', 'suggested unknown');
  assert.equal(card.className, 'value suggested unknown');
  assert.deepEqual([card.textContent, card.children.length], ['-18.0', 0], 'no unit leaves no span, and the earlier one goes');
  c.setCardValue(card, '-20.1', ' LUFS');
  assert.equal(card.className, 'value', 'no classes leave value alone');
  assert.equal(card.textContent, '-20.1 LUFS');
});

test('setUnknown shows a card with no value as ---, with its classes and unknown', () => {
  const c = load({ document: { createElement: () => cardElement('') } });
  const card = cardElement('value suggested');
  c.setCardValue(card, '150', '%', 'suggested');
  c.setUnknown(card, 'suggested');
  assert.deepEqual([card.textContent, card.className, card.children.length], ['---', 'value suggested unknown', 0]);
  c.setUnknown(card);
  assert.equal(card.className, 'value unknown');
});

test('drawOwnerName shows the owner\'s name, or the catalog\'s text where there is none, with the full text as its title', () => {
  const classes = new Set(['uploader-name', 'empty']);
  const el = { textContent: 'markup', title: '' };
  el.classList = { toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); } };
  const c = load({ chrome: { i18n: { getMessage: (key) => (key === 'ownerMissing' ? 'Not detected' : '') } } });
  c.drawOwnerName(el, 'A rather long channel name', 'ownerMissing');
  assert.deepEqual([el.textContent, el.title, classes.has('empty')], ['A rather long channel name', 'A rather long channel name', false]);
  for (const name of ['', undefined, null]) {
    c.drawOwnerName(el, name, 'ownerMissing');
    assert.deepEqual([el.textContent, el.title, classes.has('empty')], ['Not detected', 'Not detected', true], `${name}`);
  }
  assert.ok(classes.has('uploader-name'), 'the element keeps its other classes');
});

test('isSiteTab reads the host name of the tab\'s URL: the host and its subdomains, and nothing else', () => {
  const c = load({ URL });
  const on = (url) => c.isSiteTab({ url }, 'youtube.com');
  assert.deepEqual(
    ['https://www.youtube.com/watch?v=x', 'https://youtube.com/', 'https://m.youtube.com/'].map(on),
    [true, true, true]);
  assert.deepEqual(
    ['https://example.com/?next=youtube.com', 'https://notyoutube.com/', 'https://youtube.com.example.com/', 'chrome://newtab/', ''].map(on),
    [false, false, false, false, false]);
  assert.equal(c.isSiteTab({}, 'youtube.com'), false, 'a tab whose URL the popup cannot read');
  assert.equal(c.isSiteTab(undefined, 'youtube.com'), false, 'no tab');
});

test('showPopupStatus puts the catalog\'s text in the status line in place of the screen, and hidePopupStatus puts the screen back', () => {
  const element = () => {
    const classes = new Set();
    return { textContent: '', classes, classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n) } };
  };
  const line = element();
  const main = element();
  line.classes.add('hidden');
  const c = load({ chrome: { i18n: { getMessage: (key) => (key === 'reloadPageNeeded' ? 'Reload the page' : '') } } });
  c.showPopupStatus(line, main, 'reloadPageNeeded');
  assert.deepEqual([line.textContent, line.classes.has('hidden'), main.classes.has('hidden')], ['Reload the page', false, true]);
  c.hidePopupStatus(line, main);
  assert.deepEqual([line.classes.has('hidden'), main.classes.has('hidden')], [true, false]);
});

test('followDisplayUnit reads the unit, follows changes in sync, and lets a change made during the read stand', async () => {
  const listeners = [];
  let stored = { displayUnit: 'dB' };
  let release = null;
  let hold = false;
  const storage = {
    onChanged: { addListener: (fn) => listeners.push(fn) },
    sync: { get: async (key) => {
      if (hold) await new Promise((resolve) => { release = resolve; });
      return { [key]: stored };
    } },
    local: { get: async () => ({}) }
  };
  const c = load({});
  const seen = [];
  const read = c.followDisplayUnit((unit) => seen.push(unit), storage);
  assert.equal(await read(), 'dB');
  stored = {};
  assert.equal(await read(), '%', 'no unit stored is %');

  const fire = (changes, area) => listeners.forEach((fn) => fn(changes, area));
  fire({ autoLoudnessSettings: { newValue: { displayUnit: 'dB' } } }, 'sync');
  fire({ autoLoudnessSettings: { newValue: undefined } }, 'sync');
  fire({ autoLoudnessSettings: { newValue: { displayUnit: 'dB' } } }, 'local');
  fire({ otherKey: { newValue: { displayUnit: 'dB' } } }, 'sync');
  assert.deepEqual(seen, ['dB', '%'], 'a change in sync to the settings key, and nothing else');

  hold = true;
  stored = { displayUnit: '%' };
  const pending = read();
  for (let turn = 0; turn < 5 && !release; turn++) await Promise.resolve();
  fire({ autoLoudnessSettings: { newValue: { displayUnit: 'dB' } } }, 'sync');
  release();
  assert.equal(await pending, null, 'a read a change came during gives way to it');
  assert.deepEqual(seen, ['dB', '%', 'dB']);

  hold = false;
  const failing = { onChanged: { addListener() {} }, sync: { get: async () => { throw new Error('read failed'); } }, local: { get: async () => ({}) } };
  await assert.rejects(c.followDisplayUnit(() => {}, failing)(), /read failed/, 'a read that fails rejects');
  assert.equal(await c.followDisplayUnit(() => {}, { sync: storage.sync, local: storage.local })(), '%', 'a storage with no change events still reads');
});

test('showSettingsError shows #settingsError with the catalog\'s text for a key, and hides it', () => {
  const line = { textContent: 'markup', hidden: true };
  line.classList = { toggle: (name, force) => { assert.equal(name, 'hidden'); line.hidden = force; } };
  const c = load({
    document: { getElementById: (id) => (id === 'settingsError' ? line : null) },
    chrome: { i18n: { getMessage: (key) => ({ settingsSaveFailed: 'Not saved', settingsLoadFailed: 'Not loaded' })[key] || '' } }
  });
  c.showSettingsError(true);
  assert.deepEqual([line.textContent, line.hidden], ['Not saved', false], 'the save failure by default');
  c.showSettingsError(true, 'settingsLoadFailed');
  assert.deepEqual([line.textContent, line.hidden], ['Not loaded', false]);
  c.showSettingsError(false, 'settingsSaveFailed');
  assert.deepEqual([line.textContent, line.hidden], ['Not loaded', true], 'hiding leaves the text');
});

test('retryGetState asks again until done, at most the times given, and stops at an empty answer or a failure', async () => {
  // Each timer runs when the case lets it, and its delay is kept.
  const timers = [];
  const delays = [];
  const setTimeout = (fn, ms) => { timers.push(fn); delays.push(ms); };
  const c = load({ setTimeout });
  const flush = async () => {
    while (timers.length) { await timers.shift()(); await new Promise((resolve) => setImmediate(resolve)); }
  };
  const run = async (remaining, answers, doneAfter = Infinity) => {
    const taken = [];
    let asked = 0;
    c.retryGetState(remaining, 500, {
      done: () => taken.length >= doneAfter,
      ask: async () => { const a = answers[asked++]; if (a instanceof Error) throw a; return a; },
      take: (state) => taken.push(state)
    });
    await flush();
    return { asked, taken };
  };
  assert.deepEqual(await run(3, [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]), { asked: 3, taken: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    'no more asks than remaining');
  assert.ok(delays.length === 3 && delays.every((ms) => ms === 500), `each ask waits the interval (${delays})`);
  assert.deepEqual(await run(5, [{ n: 1 }, { n: 2 }, { n: 3 }], 2), { asked: 2, taken: [{ n: 1 }, { n: 2 }] },
    'a state that settles it ends the asking');
  assert.deepEqual(await run(5, [{ n: 1 }, null, { n: 3 }]), { asked: 2, taken: [{ n: 1 }] }, 'an empty answer ends it');
  assert.deepEqual(await run(5, [new Error('gone'), { n: 2 }]), { asked: 1, taken: [] }, 'and so does a failed ask');
  assert.deepEqual(await run(0, [{ n: 1 }]), { asked: 0, taken: [] }, 'none remaining asks nothing');
  assert.deepEqual(await run(5, [{ n: 1 }], 0), { asked: 0, taken: [] }, 'and nor does a state already settled');
  // Settled while the timer waits: the ask is not made.
  const taken = [];
  let settled = false;
  let asked = 0;
  c.retryGetState(5, 500, { done: () => settled, ask: async () => { asked++; return { n: 1 }; }, take: (s) => taken.push(s) });
  settled = true;
  await flush();
  assert.deepEqual([asked, taken.length], [0, 0], 'a state settled while the timer waits is not asked for');
});

test('sendTabMessage sends to the popup\'s tab and answers with its reply, and a popup with no tab sends nothing', async () => {
  const sent = [];
  const c = load({ chrome: { tabs: { sendMessage: async (tabId, message) => { sent.push([tabId, message]); return { ok: true }; } } } });
  assert.deepEqual(await c.sendTabMessage(7, { type: 'getState' }), { ok: true });
  assert.deepEqual(sent, [[7, { type: 'getState' }]]);
  for (const tabId of [null, undefined, 0]) {
    await assert.rejects(c.sendTabMessage(tabId, { type: 'getState' }), /no tab/, `tab ${tabId}`);
  }
  assert.equal(sent.length, 1, 'nothing is sent without a tab');
});

test('createSaveNotice is raised by the latest save\'s answer that is not ok, lowered by one that is, and by another owner', () => {
  const hint = { textContent: 'hint', error: false };
  hint.classList = { toggle: (name, force) => { assert.equal(name, 'error'); hint.error = force; } };
  const c = load({ chrome: { i18n: { getMessage: (key) => (key === 'gainSaveFailed' ? 'Not saved' : '') } } });
  const notice = c.createSaveNotice();
  const save = (answer) => notice.send()(answer);
  assert.equal(notice.raised(), false);
  assert.equal(notice.draw(hint), false);
  assert.deepEqual([hint.textContent, hint.error], ['hint', false], 'a notice not raised leaves the hint');
  notice.showOwner('user:1');
  for (const answer of [{ ok: false, reason: 'state moved' }, { ok: false, reason: 'storage update failed' }, undefined, null, {}]) {
    assert.equal(save({ ok: true }), true);
    assert.equal(save(answer), false, `${JSON.stringify(answer)} is not ok`);
    assert.equal(notice.raised(), true, `${JSON.stringify(answer)} raises it`);
  }
  assert.equal(notice.draw(hint), true);
  assert.deepEqual([hint.textContent, hint.error], ['Not saved', true]);
  assert.equal(save({ ok: true }), true);
  assert.equal(notice.raised(), false, 'an answer that is ok lowers it');
  notice.draw(hint);
  assert.equal(hint.error, false);
  // The owner: the same one again and none leave it; another one lowers it.
  save(null);
  notice.showOwner('user:1');
  notice.showOwner('');
  assert.equal(notice.raised(), true, 'the same owner and none leave it');
  notice.showOwner('user:2');
  assert.equal(notice.raised(), false, 'another owner lowers it');
  save(null);
  notice.showOwner('');
  notice.showOwner('user:2');
  assert.equal(notice.raised(), true, 'none in between is not another owner');
});

test('createSaveNotice leaves the notice to the latest save, and to the owner it was sent for', () => {
  const c = load();
  const notice = c.createSaveNotice();
  notice.showOwner('UCa|video');
  // An earlier save answered after a later one: the later one's answer stands.
  const first = notice.send();
  const second = notice.send();
  assert.equal(second({ ok: false, reason: 'state moved' }), false);
  assert.equal(first({ ok: true }), true, 'the earlier answer still says whether it was ok');
  assert.equal(notice.raised(), true, 'an earlier save that landed does not take the later one\'s notice down');
  const third = notice.send();
  const fourth = notice.send();
  fourth({ ok: true });
  third(null);
  assert.equal(notice.raised(), false, 'nor does an earlier one that failed raise it');

  // A save sent while another owner was shown.
  const forA = notice.send();
  notice.showOwner('UCb|video');
  assert.equal(forA({ ok: false, reason: 'request failed' }), false);
  assert.equal(notice.raised(), false, 'its failure does not raise the notice for the owner shown now');
  const forB = notice.send();
  forB(null);
  assert.equal(notice.raised(), true, 'a save sent for the owner shown is taken');

  // A save for another owner than the one shown, such as a gesture begun
  // before the popup came to show this one.
  const late = notice.send('UCb|video');
  const begunOnA = notice.send('UCa|video');
  assert.equal(begunOnA({ ok: false, reason: 'state moved' }), false, 'its answer still says whether it was ok');
  assert.equal(late({ ok: true }), true);
  assert.equal(notice.raised(), false, 'it does not raise the notice, nor make the save for the owner shown an earlier one');
  notice.send('UCb|video')(null);
  const begunOnAAgain = notice.send('UCa|video');
  begunOnAAgain({ ok: true });
  assert.equal(notice.raised(), true, 'nor does its ok take the notice down');
});

// A popup's gain slider and the window, each keeping its listeners, the
// timers holdPopupSlider sets (run when the case says so), and what the popup
// is handed: each gesture's begin, the value drawn, previews and saves.
function popupSlider({ value = 100, previewing = true } = {}) {
  const on = (target) => (type, fn) => { (target.listeners[type] ||= []).push(fn); };
  const slider = { value: String(value), listeners: {} };
  slider.addEventListener = on(slider);
  const win = { listeners: {} };
  win.addEventListener = on(win);
  const timers = [];
  const delays = [];
  const popup = { begins: 0, drawn: [], previews: [], saves: [], cancels: 0, previewing };
  const c = load({ window: win, setTimeout: (fn, ms) => { timers.push(fn); delays.push(ms); } });
  const held = c.holdPopupSlider(slider, {
    begin: () => { popup.begins++; },
    draw: (v) => { popup.drawn.push(v); },
    canPreview: () => popup.previewing,
    preview: (v) => { popup.previews.push(v); },
    save: (v) => { popup.saves.push(v); },
    cancel: () => { popup.cancels++; }
  });
  const fire = (target, type, event = {}) => {
    for (const fn of target.listeners[type] || []) fn({ target, button: 0, ...event });
  };
  const move = (v) => { slider.value = String(v); fire(slider, 'input'); };
  const runTimers = () => { for (const fn of timers.splice(0)) fn(); };
  return { c, slider, popup, held, delays, runTimers, move, fire: (type, event) => fire(slider, type, event), blurWindow: () => fire(win, 'blur') };
}

test('holdPopupSlider previews a drag, keeps it alive while held, and saves it at its change', () => {
  const s = popupSlider();
  s.fire('pointerdown');
  assert.deepEqual([s.held(), s.popup.begins], [true, 1], 'a press of the primary button begins a gesture and is held');
  s.move(150); s.move(200);
  assert.deepEqual([s.popup.drawn, s.popup.previews, s.popup.saves], [[150, 200], [150, 200], []], 'each input is drawn and previewed');
  s.runTimers();
  s.runTimers();
  assert.deepEqual(s.popup.previews, [150, 200, 200, 200], 'held still, the preview is sent again each period');
  assert.ok(vm.runInContext('PREVIEW_KEEP_ALIVE_MS', s.c) === 1000 && s.delays.every((ms) => ms === 1000), `every ${s.delays}`);
  s.fire('change');
  s.fire('pointerup');
  assert.deepEqual([s.popup.saves, s.held()], [[200], false], 'its change saves once');
  s.runTimers();
  assert.equal(s.popup.previews.length, 4, 'a saved preview is not sent again');

  // A release on the value the drag began on fires no change and saves
  // nothing; the preview left over is not kept alive.
  s.fire('pointerdown');
  s.move(300); s.move(200);
  s.fire('pointerup');
  s.runTimers();
  assert.deepEqual([s.popup.saves, s.popup.previews.slice(4)], [[200], [300, 200]], 'nothing is saved or sent again');

  for (const button of [1, 2]) {
    s.fire('pointerdown', { button });
    assert.equal(s.held(), false, `a press with button ${button} holds nothing`);
  }
});

test('holdPopupSlider begins a gesture at an input with none in progress, and previews only where canPreview holds', () => {
  const s = popupSlider({ previewing: false });
  s.move(120);
  assert.deepEqual([s.popup.begins, s.popup.drawn, s.popup.previews], [1, [120], []], 'an input begins one, and is drawn with no preview');
  s.move(130);
  assert.equal(s.popup.begins, 1, 'and the next input is part of it');
  s.fire('change');
  assert.deepEqual(s.popup.saves, [130]);
  s.move(140);
  assert.equal(s.popup.begins, 2, 'after the save an input begins another');
  s.fire('change');
  s.slider.value = '145';
  s.fire('change');
  assert.deepEqual([s.popup.begins, s.popup.saves], [3, [130, 140, 145]], 'and so does a change with none in progress');
  s.popup.previewing = true;
  s.fire('pointerdown');
  s.move(150);
  s.popup.previewing = false;
  s.runTimers();
  assert.deepEqual(s.popup.previews, [150], 'the keep-alive sends nothing where canPreview no longer holds');
});

test('holdPopupSlider saves a key hold once, at the keyup of the last value key, where a key moved the value', () => {
  const s = popupSlider();
  s.fire('keydown', { key: 'ArrowRight' });
  assert.deepEqual([s.held(), s.popup.begins], [true, 1]);
  s.move(105); s.fire('change');
  s.fire('keydown', { key: 'ArrowRight', repeat: true });
  s.move(110); s.fire('change');
  assert.deepEqual([s.popup.previews, s.popup.saves], [[105, 110], []], 'each repeat previews, and its change saves nothing');
  s.runTimers();
  assert.deepEqual(s.popup.previews, [105, 110, 110], 'a key held still keeps its preview alive');
  s.fire('keydown', { key: 'ArrowRight' });
  assert.equal(s.popup.begins, 1, 'the key pressed again stays in the hold');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual([s.popup.saves, s.held()], [[110], false], 'its keyup saves once');

  s.fire('keydown', { key: 'Tab' });
  assert.equal(s.held(), false, 'another key holds nothing');
  s.fire('keydown', { key: 'ArrowLeft' });
  s.fire('keyup', { key: 'ArrowLeft' });
  assert.deepEqual(s.popup.saves, [110], 'a hold that moved nothing saves nothing');
});

test('holdPopupSlider keeps a key hold and its value through a press of the pointer', () => {
  const s = popupSlider();
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(120); s.fire('change');
  s.fire('pointerdown');
  assert.equal(s.popup.begins, 1, 'the press begins no gesture of its own');
  s.fire('pointerup');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.popup.saves, [120], 'the keyup saves the value the key moved to');

  // A drag during the hold: its change waits for the key, whose keyup saves
  // the value the slider stands on.
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(125);
  s.fire('pointerdown');
  s.move(160); s.fire('change');
  s.fire('pointerup');
  assert.deepEqual(s.popup.saves, [120], 'the drag\'s change saves nothing while the key is held');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.popup.saves, [120, 160]);

  // A key pressed during a drag joins it.
  s.fire('pointerdown');
  s.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(s.popup.begins, 3, 'the key begins no gesture of its own');
  s.move(155);
  s.fire('keyup', { key: 'ArrowLeft' });
  assert.deepEqual(s.popup.saves, [120, 160, 155], 'and its keyup saves what it moved');
});

test('holdPopupSlider keeps a press of the pointer that a key hold saved within as one gesture', () => {
  // The key is let go of, and saves, while the pointer is still down; the
  // release's change that follows carries nothing new.
  const s = popupSlider();
  s.fire('keydown', { key: 'ArrowRight' });
  s.fire('pointerdown');
  s.move(195);
  s.fire('keyup', { key: 'ArrowRight' });
  s.fire('pointerup');
  s.fire('change');
  assert.deepEqual([s.popup.saves, s.popup.begins], [[195], 1], 'the release saves nothing more and begins nothing');
  // A state drawn on the slider before the release, with no input of its own.
  s.fire('keydown', { key: 'ArrowRight' });
  s.fire('pointerdown');
  s.move(198);
  s.fire('keyup', { key: 'ArrowRight' });
  s.slider.value = '140';
  s.fire('pointerup');
  s.fire('change');
  assert.deepEqual([s.popup.saves, s.popup.begins, s.slider.value], [[195, 198], 2, '140'],
    'a value drawn before the release is not saved, and stays drawn');

  // The drag goes on after the key's save: it stays the gesture it was, and
  // its change saves what it moved to.
  s.fire('keydown', { key: 'ArrowRight' });
  s.fire('pointerdown');
  s.move(200);
  s.fire('keyup', { key: 'ArrowRight' });
  s.move(220);
  s.fire('change');
  s.fire('pointerup');
  assert.deepEqual([s.popup.saves, s.popup.begins], [[195, 198, 200, 220], 3], 'the drag after the key is part of its gesture');

  // A drag the browser cancels after the key saved within it saves nothing
  // more, whatever it moved since, and draws nothing.
  s.fire('keydown', { key: 'ArrowRight' });
  s.fire('pointerdown');
  s.move(240);
  s.fire('keyup', { key: 'ArrowRight' });
  s.move(260);
  const drawn = s.popup.drawn.length;
  s.fire('pointercancel');
  s.fire('change');
  assert.deepEqual([s.slider.value, s.popup.saves.at(-1), s.popup.drawn.length], ['260', 240, drawn],
    'the cancel saves nothing and draws nothing');
});

test('holdPopupSlider takes a drag whose release comes ahead of its change as one gesture', () => {
  const s = popupSlider();
  s.fire('pointerdown');
  s.move(150);
  s.fire('pointerup');
  s.fire('change');
  assert.deepEqual([s.popup.saves, s.popup.begins], [[150], 1], 'the change after the release saves within the same gesture');
  // A cancel that reaches the slider once it is let go of ends nothing.
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(155);
  s.fire('keyup', { key: 'ArrowRight' });
  s.fire('pointercancel');
  s.move(158); s.fire('change');
  assert.deepEqual([s.slider.value, s.popup.saves], ['158', [150, 155, 158]], 'a cancel with no press held leaves the slider answering');
});

test('holdPopupSlider ends a gesture at a blur, and sends nothing after it until the next press', () => {
  for (const blur of ['slider', 'window']) {
    const s = popupSlider();
    const blurIt = () => (blur === 'window' ? s.blurWindow() : s.fire('blur'));
    // A key hold saves at the blur.
    s.fire('keydown', { key: 'ArrowRight' });
    s.move(130);
    blurIt();
    assert.deepEqual([s.popup.saves, s.held()], [[130], false], `${blur}: a key hold saves at the blur`);
    s.move(140); s.fire('change');
    s.fire('keyup', { key: 'ArrowRight' });
    assert.deepEqual([s.popup.saves, s.popup.previews, s.slider.value], [[130], [130], '130'],
      `${blur}: after it, input and change send nothing, and the thumb goes back`);
    s.fire('keydown', { key: 'ArrowRight', repeat: true });
    s.move(150);
    assert.deepEqual(s.popup.previews, [130], `${blur}: a repeat is no new press`);

    // A drag: the change ahead of the blur saved, and the release's change
    // after it saves nothing.
    s.fire('pointerdown');
    s.move(200); s.fire('change');
    blurIt();
    s.move(250); s.fire('change'); s.fire('pointerup');
    assert.deepEqual([s.popup.saves, s.slider.value], [[130, 200], '200'], `${blur}: a drag after the blur saves nothing more`);
    s.runTimers();
    assert.equal(s.popup.previews.at(-1), 200, `${blur}: and sends nothing again`);

    // A blur with nothing held ends nothing.
    blurIt();
    s.move(210); s.fire('change');
    assert.deepEqual(s.popup.saves, [130, 200], `${blur}: with nothing held, the ended gesture stays ended`);
    s.fire('pointerdown');
    s.move(220); s.fire('change');
    assert.deepEqual(s.popup.saves, [130, 200, 220], `${blur}: the next press begins again`);
    // A blur after a gesture that ended on its own ends nothing.
    s.fire('pointerup');
    blurIt();
    s.move(230); s.fire('change');
    assert.deepEqual(s.popup.saves, [130, 200, 220, 230], `${blur}: a blur with nothing held leaves the slider answering`);
  }
});

test('holdPopupSlider takes a cancel where the popup gives it nothing to tell', () => {
  const on = (target) => (type, fn) => { (target.listeners[type] ||= []).push(fn); };
  const slider = { value: '100', listeners: {} };
  slider.addEventListener = on(slider);
  const win = { listeners: {} };
  win.addEventListener = on(win);
  const saves = [];
  const c = load({ window: win, setTimeout: () => {} });
  c.holdPopupSlider(slider, { begin() {}, draw() {}, canPreview: () => true, preview() {}, save: (v) => saves.push(v) });
  const fire = (type) => { for (const fn of slider.listeners[type] || []) fn({ target: slider, button: 0 }); };
  fire('pointerdown');
  slider.value = '300';
  fire('input');
  assert.doesNotThrow(() => fire('pointercancel'));
  fire('change');
  assert.deepEqual([saves, slider.value], [[], '300'], 'the cancel ends the gesture all the same');
});

test('holdPopupSlider saves nothing for a drag the browser cancels, and leaves what is drawn to the tab', () => {
  const s = popupSlider();
  s.fire('pointerdown');
  s.move(300);
  s.fire('pointercancel');
  assert.deepEqual([s.slider.value, s.popup.drawn, s.held(), s.popup.cancels], ['300', [300], false, 1],
    'the cancel draws nothing, and is told: the tab puts its gain back once the previews stop, and says so');
  s.runTimers();
  s.move(320); s.fire('change');
  assert.deepEqual([s.popup.saves, s.popup.previews, s.slider.value], [[], [300], '300'],
    'nothing is sent again, nothing after it saves, and its change puts the thumb back to where the cancel left it');
  // A key held through a cancelled press stays held, and its keyup saves the
  // value the slider stands on.
  s.fire('keydown', { key: 'ArrowRight' });
  s.move(110);
  s.fire('pointerdown');
  s.move(130);
  s.fire('pointercancel');
  assert.equal(s.slider.value, '130', 'the thumb stays where it is');
  s.fire('keydown', { key: 'ArrowRight', repeat: true });
  s.move(135);
  assert.equal(s.popup.previews.at(-1), 135, 'the key goes on being heard');
  s.fire('keyup', { key: 'ArrowRight' });
  assert.deepEqual(s.popup.saves, [135], 'the key keeps its hold through it');

  // A cancel with no press held ends nothing.
  s.fire('pointerdown');
  s.move(170); s.fire('change'); s.fire('pointerup');
  s.fire('pointercancel');
  assert.equal(s.popup.cancels, 1, 'neither a cancel during a key hold nor one with nothing pressed is told');
  s.move(175); s.fire('change');
  assert.deepEqual([s.slider.value, s.popup.saves], ['175', [135, 170, 175]], 'a cancel after the release leaves the slider answering');
});
