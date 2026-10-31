// common.test.cjs — core/common.js, what the extensions load ahead of their
// own scripts: the settings key, the settings read and move, the serial queue,
// the Target LUFS default and range, the gain range, the runtime check, gain
// conversion and display (Auto's included), the gain for a level, the slider
// keys, the catalog lookup, and the HTML escape.

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
