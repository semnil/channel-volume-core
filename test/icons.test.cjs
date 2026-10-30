// icons.test.cjs — gen_icons.py draws the icons beside itself, in the colours
// and with the mark core.json names, and refuses a machine with no face to
// draw the mark with and a core.json that names no icon it can draw.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { shared, PACKAGE, writeCore, withFixtureDir } = require('./helpers.cjs');

const SOURCE = fs.readFileSync(shared('gen_icons.py'), 'utf8');
// The names gen_icons.py writes, one for each of its sizes.
const DRAWN = ['icon128.png', 'icon16.png', 'icon48.png'];
const FONT_LIST = /^FONT_PATHS = \[[^\]]*\]/m;

// What drawing needs from the host, asked of the host rather than of
// gen_icons.py: Pillow, and one of the faces FONT_PATHS lists. A case skips
// where its need is missing, and fails where gen_icons.py says it is missing
// although it is here.
const pillow = spawnSync('python3', ['-B', '-c', 'import PIL'], { encoding: 'utf8' });
const NO_PILLOW = (pillow.error || pillow.status !== 0)
  && `Pillow cannot be imported here: ${(pillow.error || pillow.stderr || '').toString().trim().split('\n').pop()}`;
const faces = ((SOURCE.match(FONT_LIST) || [''])[0].match(/'[^']+'/g) || [])
  .map((quoted) => quoted.slice(1, -1));
const NO_FACE = NO_PILLOW
  || (faces.length > 0 && !faces.some((face) => fs.existsSync(face))
    && `none of the faces gen_icons.py looks for is here: ${faces.join(', ')}`);

const STYLE = { background: [24, 24, 27], accent: [145, 70, 255], letter: 'T' };

// gen_icons.py and core.json in `dir`, with an icons/ beside them to draw into.
function iconBox(dir, config, source = SOURCE) {
  fs.writeFileSync(path.join(dir, 'gen_icons.py'), source);
  fs.mkdirSync(path.join(dir, 'icons'));
  if (config !== undefined) writeCore(dir, config);
}

const draw = (dir, cwd) => spawnSync('python3', ['-B', path.join(dir, 'gen_icons.py')],
  { cwd, encoding: 'utf8' });

// Each drawn icon's size, its colours by how many opaque pixels carry each,
// and the pixels the largest one has inside the tallest bar and in its
// background below the bars.
function readIcons(dir) {
  const read = spawnSync('python3', ['-B', '-c', [
    'import json, sys',
    'from PIL import Image',
    'for name in sys.argv[1:]:',
    '    img = Image.open(name).convert("RGBA")',
    '    w, h = img.size',
    '    opaque = sorted(([n, list(c[:3])] for n, c in img.getcolors(w * h) if c[3] == 255), reverse=True)',
    '    pixels = [list(img.getpixel(xy)) for xy in ((92, 95), (110, 110))] if w == 128 else []',
    '    print(json.dumps({"name": name, "size": [w, h], "opaque": opaque, "pixels": pixels}))'
  ].join('\n'), ...DRAWN], { cwd: path.join(dir, 'icons'), encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  return Object.fromEntries(read.stdout.trim().split(/\r?\n/)
    .map((line) => JSON.parse(line)).map((icon) => [icon.name, icon]));
}

const bytesOf = (dir) => DRAWN.map((name) => fs.readFileSync(path.join(dir, 'icons', name)));

// Every icon is drawn on the background and carries the accent; the largest
// carries them where the tallest bar and the background are.
function assertDrawnIn(icons, { background, accent }, what) {
  for (const name of DRAWN) {
    const icon = icons[name];
    const side = Number(name.match(/\d+/)[0]);
    assert.deepEqual(icon.size, [side, side], `${name} is ${side} square (${what})`);
    assert.deepEqual(icon.opaque[0][1], background,
      `${name} is drawn on the background core.json names (${what})`);
    assert.ok(icon.opaque.some(([, colour]) => colour.join() === accent.join()),
      `${name} carries the accent core.json names (${what})`);
  }
  const [bar, ground] = icons['icon128.png'].pixels;
  assert.deepEqual(bar, [...accent, 255], `the tallest bar is the accent (${what})`);
  assert.deepEqual(ground, [...background, 255], `the ground below the bars is the background (${what})`);
}

// gen_icons.py writes beside itself rather than beside whatever directory it
// was started from, and where there is no face to draw the mark with it says so
// instead of saving one drawn with Pillow's own and reporting success.
test('the icons are drawn beside the script', { skip: NO_FACE }, () => {
  withFixtureDir('cv-icons-', (beside) => {
    withFixtureDir('cv-cwd-', (elsewhere) => {
      iconBox(beside, { package: PACKAGE, icon: STYLE });
      // Both directories can take the icons, so which one holds them answers it.
      fs.mkdirSync(path.join(elsewhere, 'icons'));
      const drawn = draw(beside, elsewhere);
      assert.equal(drawn.status, 0, drawn.stderr);
      assert.deepEqual(fs.readdirSync(path.join(beside, 'icons')).sort(), DRAWN,
        'gen_icons.py writes the icons beside itself');
      assert.deepEqual(fs.readdirSync(path.join(elsewhere, 'icons')), [],
        'gen_icons.py writes nothing under the directory it was started from');
    });
  });
});

test('the icons are not drawn where there is no face', { skip: NO_PILLOW }, () => {
  // The same script with nowhere to find a face. It runs wherever pillow is,
  // so this half needs no system font of its own.
  withFixtureDir('cv-faceless-', (faceless) => {
    const withoutAFace = SOURCE.replace(FONT_LIST, "FONT_PATHS = ['/no/such/face.ttf']");
    assert.notEqual(withoutAFace, SOURCE,
      'gen_icons.py lists the faces it looks for in FONT_PATHS');
    iconBox(faceless, { icon: STYLE }, withoutAFace);
    const refused = draw(faceless, faceless);
    assert.notEqual(refused.status, 0,
      'gen_icons.py turns down a machine with no face to draw with');
    assert.match(refused.stderr, /no face here to draw the mark with/);
    assert.match(refused.stderr, /no\/such\/face\.ttf/);
    assert.deepEqual(fs.readdirSync(path.join(faceless, 'icons')), [],
      'nothing is saved under the brand letter when there is no face for it');
  });
});

// The colours and the mark are core.json's, the one beside the script: the
// directory it is started from holds a core.json of other colours, and a
// draw that read that one fails here.
test('the icons are drawn in the colours and with the mark core.json names', { skip: NO_FACE }, () => {
  withFixtureDir('cv-cwd-', (elsewhere) => {
    writeCore(elsewhere, { icon: { background: [1, 2, 3], accent: [4, 5, 6], letter: 'Q' } });
    const drawIn = (config) => {
      let result;
      withFixtureDir('cv-style-', (dir) => {
        iconBox(dir, config);
        const drawn = draw(dir, elsewhere);
        assert.equal(drawn.status, 0, drawn.stderr);
        result = { icons: readIcons(dir), bytes: bytesOf(dir) };
      });
      return result;
    };
    const first = drawIn({ package: PACKAGE, icon: STYLE });
    assertDrawnIn(first.icons, STYLE, 'the first colours');
    const recoloured = { background: [26, 26, 46], accent: [255, 0, 0], letter: 'T' };
    const second = drawIn({ icon: recoloured });
    assertDrawnIn(second.icons, recoloured, 'the second colours');
    // The edges of a colour, each where the other one was.
    const edges = { background: [255, 255, 255], accent: [0, 0, 0], letter: 'T' };
    assertDrawnIn(drawIn({ icon: edges }).icons, edges, 'the edges of a colour');

    // The same core.json draws the same bytes, so a different mark is what
    // makes the bytes differ below.
    const again = drawIn({ icon: STYLE });
    DRAWN.forEach((name, i) => assert.ok(first.bytes[i].equals(again.bytes[i]),
      `${name} is drawn the same from the same core.json`));
    const remarked = drawIn({ icon: { ...STYLE, letter: 'I' } });
    assertDrawnIn(remarked.icons, STYLE, 'another mark');
    DRAWN.forEach((name, i) => assert.ok(!first.bytes[i].equals(remarked.bytes[i]),
      `${name} is drawn with the mark core.json names`));
    // A mark outside ASCII is one character all the same.
    assertDrawnIn(drawIn({ icon: { ...STYLE, letter: 'é' } }).icons, STYLE, 'a mark outside ASCII');
  });
});

test('a core.json that names no icon to draw is refused', { skip: NO_PILLOW }, () => {
  const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const colour = (bad) => [
    { icon: { ...STYLE, background: bad } },
    { icon: { ...STYLE, accent: bad } }
  ];
  const cases = [
    ['no core.json', undefined, /^core\.json names no icon to draw: FileNotFoundError/],
    ['a core.json that is not JSON', '{ "icon": ', /^core\.json names no icon to draw: JSONDecodeError/],
    ['a core.json naming no icon', { package: PACKAGE }, /^core\.json names no icon to draw: KeyError\('icon'\)/],
    ['a top level that is not an object', [STYLE], /^core\.json names no icon to draw: TypeError/],
    ['an icon that is not an object', { icon: 5 }, /^core\.json names no icon to draw: TypeError/],
    ['an icon naming no background', { icon: { accent: STYLE.accent, letter: 'T' } },
      /^core\.json names no icon to draw: KeyError\('background'\)/],
    ['an icon naming no accent', { icon: { background: STYLE.background, letter: 'T' } },
      /^core\.json names no icon to draw: KeyError\('accent'\)/],
    ['an icon naming no letter', { icon: { background: STYLE.background, accent: STYLE.accent } },
      /^core\.json names no icon to draw: KeyError\('letter'\)/]
  ];
  for (const [what, bad, said] of [
    ['a colour with true in it', [true, 0, 0], '[True, 0, 0]'],
    ['a colour with a fraction in it', [1.5, 0, 0], '[1.5, 0, 0]'],
    ['a colour past 255', [256, 0, 0], '[256, 0, 0]'],
    ['a colour below 0', [-1, 0, 0], '[-1, 0, 0]'],
    ['a colour of two entries', [0, 0], '[0, 0]'],
    ['a colour of four entries', [0, 0, 0, 255], '[0, 0, 0, 255]'],
    ['a colour written as text', '#000000', "'#000000'"],
    ['a colour written as null', null, 'None'],
    ['a colour with a number written as text', ['0', 0, 0], "['0', 0, 0]"],
    ['a colour written as an object', { r: 0, g: 0, b: 0 }, "{'r': 0, 'g': 0, 'b': 0}"]
  ]) {
    const [onBackground, onAccent] = colour(bad);
    const refusal = new RegExp(`^core\\.json names a colour that is not \\[r, g, b\\]: ${literally(said)}$`, 'm');
    cases.push([`${what}, as the background`, onBackground, refusal]);
    cases.push([`${what}, as the accent`, onAccent, refusal]);
  }
  // A whole number written with a fraction is a float in JSON's reading, and
  // JSON.stringify writes it without one, so this one is written as text.
  cases.push(['a colour with a whole number written as a fraction',
    `{"icon": {"background": [0.0, 0, 0], "accent": [0, 0, 0], "letter": "T"}}`,
    /^core\.json names a colour that is not \[r, g, b\]: \[0\.0, 0, 0\]$/m]);
  for (const [what, letter, said] of [
    ['an empty mark', '', "''"],
    ['a mark of two characters', 'TT', "'TT'"],
    ['a mark that is a number', 7, '7'],
    ['a mark written as null', null, 'None'],
    ['a mark written as a list', ['T'], "['T']"]
  ]) {
    cases.push([what, { icon: { ...STYLE, letter } },
      new RegExp(`^core\\.json names a mark that is not one character: ${literally(said)}$`, 'm')]);
  }

  for (const [what, config, refusal] of cases) {
    withFixtureDir('cv-icon-config-', (box) => {
      iconBox(box);
      if (typeof config === 'string') fs.writeFileSync(path.join(box, 'core.json'), config);
      else if (config !== undefined) writeCore(box, config);
      const refused = draw(box, box);
      assert.equal(refused.status, 1, `gen_icons.py refuses ${what} — ${refused.stderr}`);
      assert.ok(refused.stderr.startsWith('core.json names '),
        `the refusal of ${what} is all gen_icons.py says — ${refused.stderr}`);
      assert.match(refused.stderr, refusal, `gen_icons.py names what is wrong with ${what}`);
      assert.equal(refused.stdout, '', `gen_icons.py says it generated nothing with ${what}`);
      assert.deepEqual(fs.readdirSync(path.join(box, 'icons')), [],
        `nothing is saved with ${what}`);
    });
  }
});
