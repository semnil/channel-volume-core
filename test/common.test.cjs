// common.test.cjs — core/common.js, what the extensions load ahead of their
// utils.js: the settings key and default target, the runtime check, gain
// conversion and display (Auto's included), the catalog lookup, and the HTML
// escape.

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

test('the settings key and the default Target LUFS are the extensions\' values', () => {
  const c = load();
  assert.equal(vm.runInContext('SETTINGS_KEY', c), 'autoLoudnessSettings');
  assert.equal(vm.runInContext('DEFAULT_TARGET_LUFS', c), -18);
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
