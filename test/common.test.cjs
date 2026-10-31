// common.test.cjs — core/common.js, what the extensions load ahead of their
// own scripts: the settings key, the Target LUFS default and range, the gain
// range, the runtime check, gain conversion and display (Auto's included), the
// gain for a level, the slider keys, the catalog lookup, and the HTML escape.

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
