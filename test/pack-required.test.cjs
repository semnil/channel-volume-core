// pack-required.test.cjs — pack.py refuses a package that leaves out what it
// has to carry or that Chrome declines to load, takes every shape Chrome
// reads, and writes the same archive from the same files.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { shared, zipName, writeCore, tempDir, heldInZip } = require('./helpers.cjs');

const PACK = shared('pack.py');

test('the store package refuses to leave out what it has to carry', (t) => {
  // Every box a case makes goes when the test ends, whichever way it ends.
  const made = [];
  t.after(() => { for (const box of made) fs.rmSync(box, { recursive: true, force: true }); });
  // The release workflow runs pack.py and uploads what it writes without
  // running any of this, so an omission that still exits 0 ships.
  const runPack = (box, args) => spawnSync('python3', ['-B', 'pack.py', ...args],
    { cwd: box, encoding: 'utf8' });
  const buildMinimal = () => {
    const box = tempDir('cv-required-');
    made.push(box);
    fs.copyFileSync(PACK, path.join(box, 'pack.py'));
    writeCore(box);
    fs.writeFileSync(path.join(box, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      version: '0.0.0',
      default_locale: 'ja',
      name: '__MSG_extName__',
      content_scripts: [{ js: ['content.js'] }]
    }));
    fs.writeFileSync(path.join(box, 'content.js'), '');
    fs.mkdirSync(path.join(box, '_locales/ja'), { recursive: true });
    // The manifest asks for extName, so the catalog answers for it.
    fs.writeFileSync(path.join(box, '_locales/ja/messages.json'),
      JSON.stringify({ extName: { message: 'Minimal' } }));
    fs.writeFileSync(path.join(box, 'LICENSE'), 'MIT License\n');
    return box;
  };

  const whole = buildMinimal();
  const listed = runPack(whole, ['--list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort(),
    ['LICENSE', '_locales/ja/messages.json', 'content.js', 'manifest.json']);
  fs.rmSync(whole, { recursive: true, force: true });

  const writeCatalog = (box, catalog) =>
    fs.writeFileSync(path.join(box, '_locales/ja/messages.json'), JSON.stringify(catalog));
  const readBoxJson = (box) => JSON.parse(fs.readFileSync(`${box}/manifest.json`, 'utf8'));
  // A value the manifest carries as it stands. JSON.stringify spells no
  // NaN, no comment and no escape, and the manifest is where Chrome reads
  // all three.
  const appendRaw = (box, raw) => fs.writeFileSync(`${box}/manifest.json`,
    `${JSON.stringify(readBoxJson(box)).slice(0, -1)},${raw}}`);
  const editManifest = (box, change) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(box, 'manifest.json'), 'utf8'));
    change(manifest);
    fs.writeFileSync(path.join(box, 'manifest.json'), JSON.stringify(manifest));
  };
  // The third entry, where a case carries one, is what the refusal has to say.
  // Without it a rule can be deleted and a later check refuses the same input for
  // another reason, and the case cannot tell the two apart.
  for (const [broken, breakIt, diagnosis] of [
    ['the licence gone', (box) => fs.rmSync(path.join(box, 'LICENSE'))],
    ["the default locale's messages gone",
      (box) => fs.rmSync(path.join(box, '_locales/ja/messages.json'))],
    ['_locales gone', (box) => fs.rmSync(path.join(box, '_locales'), { recursive: true })],
    // Chrome reads _locales and default_locale as one contract: a directory
    // with nothing naming it is an extension it declines to load.
    ['no default_locale, and _locales still here',
      (box) => editManifest(box, (m) => { delete m.default_locale; })],
    ['default_locale set to an empty string',
      (box) => editManifest(box, (m) => { m.default_locale = ''; })],
    ['default_locale set to something that is not a string',
      (box) => editManifest(box, (m) => { m.default_locale = 7; })],
    ['default_locale naming a directory that is not there',
      (box) => editManifest(box, (m) => { m.default_locale = 'de'; })],
    ['a manifest reference naming a drive rather than a path inside the package',
      (box) => editManifest(box, (m) => { m.content_scripts = [{ js: ['C:/content.js'] }]; })],
    // Chrome resolves __MSG_name__ against the default locale's catalog, in the
    // manifest and in the stylesheets it serves. A placeholder with nothing to
    // resolve it against is an extension it declines to load.
    ['a message the manifest asks for and no locale assets at all',
      (box) => {
        fs.rmSync(`${box}/_locales`, { recursive: true });
        editManifest(box, m => { delete m.default_locale; });
      },
      /asks for extName and names no default_locale/],
    ['default_locale written as null',
      (box) => editManifest(box, m => { m.default_locale = null; }),
      /default_locale is not a locale name: None/],
    ['default_locale written as a path rather than a name',
      (box) => editManifest(box, m => { m.default_locale = 'ja/'; }),
      /default_locale is not one name under _locales: 'ja\/'/],
    ['default_locale written as a directory that means the one above',
      (box) => editManifest(box, m => { m.default_locale = '..'; }),
      /default_locale is not one name under _locales: '\.\.'/],
    ['a message the manifest asks for that the catalog does not answer',
      (box) => editManifest(box, m => { m.name = '__MSG_absentKey__'; }),
      /the manifest uses absentKey, which .* does not answer for/],
    ['a reference spelled with escapes that nothing answers',
      (box) => appendRaw(box, '"description":"__MSG_\\u0061bsent__"'),
      /the manifest uses absent, which .* does not answer for/],
    ['a message a packaged stylesheet asks for that the catalog does not answer',
      (box) => {
        fs.writeFileSync(`${box}/styles.css`, 'body { content: "__MSG_absentKey__" }\n');
        editManifest(box, m => {
          m.content_scripts = [{ js: ['content.js'], css: ['styles.css'] }];
        });
      },
      /styles\.css uses absentKey, which .* does not answer for/],
    ['a catalog that is not JSON',
      (box) => fs.writeFileSync(`${box}/_locales/ja/messages.json`, '{ broken'),
      /messages\.json is not readable as JSON/],
    // Chrome's parser allows comments; it does not allow a trailing comma or
    // a block comment left open.
    ['a trailing comma in a catalog',
      (box) => fs.writeFileSync(`${box}/_locales/ja/messages.json`,
        '{ "extName": { "message": "x" }, }'),
      /messages\.json is not readable as JSON/],
    ['a block comment a catalog never closes',
      (box) => fs.writeFileSync(`${box}/_locales/ja/messages.json`,
        '{ /* "extName": { "message": "x" } }'),
      /never closed/],
    ['a trailing comma in the manifest',
      (box) => fs.writeFileSync(`${box}/manifest.json`,
        '{ "manifest_version": 3, "version": "0.0.0", }'),
      /manifest\.json is not readable as JSON/],
    // Chrome reads the catalog rather than taking it on faith, and declines to
    // load the extension over any of these.
    ['a catalog whose top level is not an object',
      (box) => writeCatalog(box, [{ extName: { message: 'x' } }]),
      /is not a message catalog: the top level is a list/],
    ['an entry with no message element',
      (box) => writeCatalog(box, { extName: { description: 'x' } }),
      /gives extName no message element/],
    ['an entry whose message is not text',
      (box) => writeCatalog(box, { extName: { message: 7 } }),
      /gives extName no message element/],
    ['an entry that is not an object',
      (box) => writeCatalog(box, { extName: 'x' }),
      /gives extName a str, not an object/],
    ['a name Chrome cannot read',
      (box) => writeCatalog(box, { 'ext-name': { message: 'x' }, extName: { message: 'y' } }),
      /names a message Chrome cannot read/],
    ['a placeholder with no content',
      (box) => writeCatalog(box,
        { extName: { message: 'x $A$', placeholders: { a: { example: 'y' } } } }),
      /gives extName\.a no content/],
    // A pattern that names nothing is one Chrome takes as well. A pattern
    // that names nothing until the spelling is folded is the tree carrying
    // the files another way, and the package would go out without them —
    // which the walk cannot say, because it lists real paths and matches
    // them, so a spelling that differs reads as nothing to match.
    ['a resource pattern whose directory the tree spells another way',
      (box) => {
        fs.mkdirSync(`${box}/images`);
        fs.writeFileSync(`${box}/images/logo.png`, 'x');
        editManifest(box, m => {
          m.web_accessible_resources = [{ resources: ['Images/*.png'],
            matches: ['https://example.com/*'] }];
        });
      },
      /the tree spells this another way: Images\/\*\.png/],
    ['a resource pattern whose extension the tree spells another way',
      (box) => {
        fs.mkdirSync(`${box}/images`);
        fs.writeFileSync(`${box}/images/logo.png`, 'x');
        editManifest(box, m => {
          m.web_accessible_resources = [{ resources: ['images/*.PNG'],
            matches: ['https://example.com/*'] }];
        });
      },
      /the tree spells this another way: images\/\*\.PNG/],
    // A name that is nowhere and a name spelled another way are different
    // mistakes, and each is said as itself.
    ['a reference with no file behind it',
      (box) => fs.rmSync(`${box}/content.js`),
      /referenced file is missing or not a regular file: content\.js/],
    // A host that opens a name without regard to case hands back the file
    // the tree carries, and the package would hold two entries for the one
    // file — one of them under a name no other host can open.
    ['a reference the tree spells another way',
      (box) => editManifest(box, m => {
        m.content_scripts = [{ js: ['Content.js'] }];
      }),
      /the tree spells this another way: Content\.js/],
    // Outside a resource entry a leading slash is an absolute path, and an
    // absolute path names a file the package cannot carry.
    ['a reference beginning at the root of the host',
      (box) => editManifest(box, m => {
        m.content_scripts = [{ js: ['/content.js'] }];
      }),
      /reference leaves the package: \/content\.js/],
    // A backslash is an ordinary character in a name on a POSIX host and a
    // separator on Windows. The file is on disk under that very name — one
    // name beside sub, or content.js inside it where the backslash separates —
    // so what refuses it is the rule and not its absence.
    ['a reference spelled with a backslash',
      (box) => {
        fs.mkdirSync(`${box}/sub`);
        fs.writeFileSync(`${box}/sub\\content.js`, '');
        editManifest(box, m => {
          m.content_scripts = [{ js: ['content.js', 'sub\\content.js'] }];
        });
      },
      /reference leaves the package: sub\\content\.js/],
    // Chrome reads a version as one to four numbers, each below 2**32, the
    // first written without a leading zero. Its own message about the range
    // says 0 to 65536, which is not the bound it applies.
    ['a version carrying a prerelease suffix',
      (box) => editManifest(box, m => { m.version = '1.0.0-rc1'; }),
      /version is not one Chrome reads: '1\.0\.0-rc1'/],
    ['a version whose first part carries a leading zero',
      (box) => editManifest(box, m => { m.version = '01.1.0'; }),
      /version is not one Chrome reads: '01\.1\.0'/],
    ['a version part past the largest number one holds',
      (box) => editManifest(box, m => { m.version = '1.0.4294967296'; }),
      /version is not one Chrome reads: '1\.0\.4294967296'/],
    ['a version of five parts',
      (box) => editManifest(box, m => { m.version = '1.0.0.0.0'; }),
      /version is not one Chrome reads: '1\.0\.0\.0\.0'/],
    // A prerelease shows its name in version_name, which Chrome reads as any
    // text at all and refuses when it is not text.
    ['a version_name that is not text',
      (box) => editManifest(box, m => { m.version_name = 7; }),
      /version_name is not text: 7/],
    ['a version written as a number rather than text',
      (box) => editManifest(box, m => { m.version = 100; }),
      /version is not one Chrome reads: 100/],
    ['a version with no version at all',
      (box) => editManifest(box, m => { delete m.version; }),
      /version is not one Chrome reads: None/],
    ['a default_locale that is no locale at all',
      (box) => {
        fs.renameSync(`${box}/_locales/ja`, `${box}/_locales/jp`);
        editManifest(box, m => { m.default_locale = 'jp'; });
      },
      /is not a locale the store carries: 'jp'/],
    ['a locale the browser loads and the store does not carry',
      (box) => {
        fs.renameSync(`${box}/_locales/ja`, `${box}/_locales/nb`);
        editManifest(box, m => { m.default_locale = 'nb'; });
      },
      /is not a locale the store carries: 'nb'/],
    // Every locale under _locales reaches the package, not the default one
    // alone, so each is held to the same list. Chrome loads _locales/nb and
    // _locales/zz alike; no listing presents either.
    ['a locale beside the default one that the store does not carry',
      (box) => fs.cpSync(`${box}/_locales/ja`, `${box}/_locales/nb`, { recursive: true }),
      /_locales\/nb is not a locale the store carries: 'nb'/],
    // The store spells its regions in capitals and Chrome loads the name
    // either way, so a package can carry a locale under a spelling no listing
    // answers to. The spelling the store uses is the refusal.
    ['a locale beside the default one spelled the way the store does not',
      (box) => fs.cpSync(`${box}/_locales/ja`, `${box}/_locales/en_gb`, { recursive: true }),
      /_locales\/en_gb is spelled 'en_GB' by the store/],
    // A file the manifest reaches inside _locales lands in a locale directory
    // whatever it was meant as, and Chrome reads it as one: measured against
    // 151, a package carrying _locales/fr/icon.png with no fr catalog is
    // refused at load — "Messages file is missing for locale". The sweep
    // above cannot see these, because it looks only where a catalog is.
    ['a referenced file under a locale the store does not carry', (box) => {
      fs.mkdirSync(`${box}/_locales/nb`, { recursive: true });
      fs.writeFileSync(`${box}/_locales/nb/icon.png`, 'png');
      editManifest(box, m => { m.action = { default_icon: '_locales/nb/icon.png' }; });
    }, /_locales\/nb is not a locale the store carries: 'nb'/],
    ['a referenced file under a locale spelled the way the store does not', (box) => {
      fs.mkdirSync(`${box}/_locales/en_gb`, { recursive: true });
      fs.writeFileSync(`${box}/_locales/en_gb/icon.png`, 'png');
      editManifest(box, m => { m.action = { default_icon: '_locales/en_gb/icon.png' }; });
    }, /_locales\/en_gb is spelled 'en_GB' by the store/],
    ['a referenced file in a locale directory with no catalog', (box) => {
      fs.mkdirSync(`${box}/_locales/en`, { recursive: true });
      fs.writeFileSync(`${box}/_locales/en/icon.png`, 'png');
      editManifest(box, m => { m.action = { default_icon: '_locales/en/icon.png' }; });
    }, /_locales\/en carries _locales\/en\/icon\.png and no messages\.json/],
    ['a referenced file put straight into _locales', (box) => {
      fs.writeFileSync(`${box}/_locales/icon.png`, 'png');
      editManifest(box, m => { m.action = { default_icon: '_locales/icon.png' }; });
    }, /_locales\/icon\.png is not a locale the store carries/],
    ['a default_locale spelled the way the store does not',
      (box) => {
        fs.renameSync(`${box}/_locales/ja`, `${box}/_locales/en_gb`);
        editManifest(box, m => { m.default_locale = 'en_gb'; });
      },
      /default_locale is spelled 'en_GB' by the store/],
    // Chrome reads a JSON number as a double. NaN and the infinities are
    // Python's spelling of a number rather than JSON's, and a literal too
    // large for a double is one Chrome declines to read at all.
    ['a manifest holding a number only Python reads',
      (box) => appendRaw(box, '"x":NaN'),
      /manifest\.json is not readable as JSON: NaN is not a JSON value/],
    ['a catalog holding a number only Python reads',
      (box) => fs.writeFileSync(`${box}/_locales/ja/messages.json`,
        '{"extName":{"message":"x","description":Infinity}}'),
      /messages\.json is not readable as JSON: Infinity is not a JSON value/],
    ['a fraction larger than a number holds',
      (box) => appendRaw(box, '"x":1e400'),
      /is not readable as JSON: 1e400 is out of the range a number holds/],
    ['an integer larger than a number holds',
      (box) => appendRaw(box, `"x":1${'0'.repeat(400)}`),
      /is not readable as JSON: 10+ is out of the range a number holds/],
    // A comment stands between the tokens it separated. Dropped outright it
    // joins them into one the author never wrote.
    ['a number a block comment splits',
      (box) => appendRaw(box, '"x":1/**/2'),
      /manifest\.json is not readable as JSON: Expecting ',' delimiter/],
    ['a keyword a block comment splits',
      (box) => appendRaw(box, '"x":tr/**/ue'),
      /manifest\.json is not readable as JSON: Expecting value/],
    // Every field Chrome localizes is asked, not the first of them alone.
    ['a title the action asks for that the catalog does not answer',
      (box) => editManifest(box, m => {
        m.action = { default_title: '__MSG_absentTitle__' };
      }),
      /the manifest uses absentTitle, which .* does not answer for/],
    ['a description a command asks for that the catalog does not answer',
      (box) => editManifest(box, m => {
        m.commands = { go: { description: '__MSG_absentCommand__' } };
      }),
      /the manifest uses absentCommand, which .* does not answer for/],
    ['a name an input component asks for that the catalog does not answer',
      (box) => editManifest(box, m => {
        m.input_components = [{ name: '__MSG_absentComponent__' }];
      }),
      /the manifest uses absentComponent, which .* does not answer for/],
    ['a message under @@ that Chrome does not define',
      (box) => editManifest(box, m => { m.description = '__MSG_@@bogus__'; }),
      /the manifest uses @@bogus, which .* does not answer for/],
    ['the one message Chrome reads everywhere but the manifest, in the manifest',
      (box) => editManifest(box, m => { m.description = '__MSG_@@extension_id__'; }),
      /the manifest uses @@extension_id/],
    ['a message referring to a placeholder nothing defines',
      (box) => writeCatalog(box, { extName: { message: 'hello $WHO$' } }),
      /gives extName no placeholder named WHO/],
    ['placeholders written as null',
      (box) => writeCatalog(box, { extName: { message: 'x', placeholders: null } }),
      /gives extName placeholders that are not an object/],
    ['a placeholder Chrome cannot read',
      (box) => writeCatalog(box, { extName: { message: 'x $BAD_NAME$',
        placeholders: { 'bad-name': { content: '$1' } } } }),
      /names a placeholder Chrome cannot read/],
    // A doubled delimiter opens an empty candidate rather than escaping
    // anything, so $$NAME$$ asks for NAME; and two references share a
    // delimiter, so $A$$B$ is A then B.
    ['a doubled dollar around a name nothing defines',
      (box) => writeCatalog(box, { extName: { message: '$$NAME$$' } }),
      /gives extName no placeholder named NAME/],
    // A name is matched whole: Chromium walks every character of it, while a
    // pattern anchored with $ stops before a trailing newline.
    ['a message name ending in a newline',
      (box) => writeCatalog(box, { extName: { message: 'x' }, 'trailing\n': { message: 'y' } }),
      /names a message Chrome cannot read/],
    ['a placeholder name ending in a newline',
      (box) => writeCatalog(box,
        { extName: { message: 'x', placeholders: { 'a\n': { content: '$1' } } } }),
      /names a placeholder Chrome cannot read/],
    // Chrome supplies the reserved five and refuses a catalog that answers for
    // one of them, without regard to case. The extension id is not among them.
    ['a catalog answering for a message Chrome reserves',
      (box) => writeCatalog(box,
        { extName: { message: 'x' }, '@@ui_locale': { message: 'y' } }),
      /answers for @@ui_locale, which Chrome reserves/],
    ['a catalog answering for a reserved name spelled in capitals',
      (box) => writeCatalog(box,
        { extName: { message: 'x' }, '@@BIDI_DIR': { message: 'y' } }),
      /answers for @@BIDI_DIR, which Chrome reserves/],
    // The manifest is localized before Chrome has an extension id, so the name
    // is matched there without regard to case as everywhere else.
    ['the extension id asked for in capitals in the manifest',
      (box) => editManifest(box, m => { m.description = '__MSG_@@EXTENSION_ID__'; }),
      /the manifest uses @@EXTENSION_ID/],
    ['two references sharing a delimiter, one of them undefined',
      (box) => writeCatalog(box, { extName: { message: '$A$$B$',
        placeholders: { ab: { content: '$1' } } } }),
      /gives extName no placeholder named A/],
    // The second reference is what the shared delimiter opens, so it has to be
    // the one that fails here: a walk restarting past the delimiter never
    // reaches it.
    ['the second of two references sharing a delimiter undefined',
      (box) => writeCatalog(box, { extName: { message: '$A$$B$',
        placeholders: { a: { content: '$1' } } } }),
      /gives extName no placeholder named B/]
  ]) {
    const box = buildMinimal();
    // A package built earlier stands here, so a refusal has something to spare.
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    const zip = path.join(box, zipName('0.0.0'));
    const before = fs.statSync(zip).size;
    breakIt(box);
    for (const args of [['--list'], []]) {
      const refused = runPack(box, args);
      assert.notEqual(refused.status, 0,
        `pack.py ${args.join(' ')} refuses a package with ${broken}`);
      assert.doesNotMatch(refused.stdout || '', /^\s*\+ /m,
        `pack.py names nothing as packed with ${broken}`);
      // A traceback exits non-zero too, and says what broke rather than what is
      // wrong with the package.
      assert.doesNotMatch(refused.stderr || '', /Traceback \(most recent call last\)/,
        `pack.py says what is wrong with ${broken}, instead of raising`);
      if (diagnosis) {
        assert.match(refused.stderr || '', diagnosis,
          `pack.py names what is wrong with ${broken}`);
      }
    }
    assert.ok(fs.existsSync(zip) && fs.statSync(zip).size === before,
      `the package built before is left alone with ${broken}`);
    fs.rmSync(box, { recursive: true, force: true });
  }

  // Four shapes Chrome reads without complaint. Each is a rule the checks above
  // could over-reach into: a name with an @ in it, Chrome's own message where
  // it is allowed, a literal dollar, and a positional argument in a
  // placeholder's content.
  for (const [shape, arrange] of [
    ['a message named with an @ in it', (box) => {
      writeCatalog(box, { 'foo@bar': { message: 'x' } });
      editManifest(box, m => { m.name = '__MSG_foo@bar__'; });
    }],
    ['the extension id read from a stylesheet', (box) => {
      fs.writeFileSync(`${box}/styles.css`,
        'body { background: url("__MSG_@@extension_id__") }\n');
      editManifest(box, m => {
        m.content_scripts = [{ js: ['content.js'], css: ['styles.css'] }];
      });
    }],
    ['a positional argument in a placeholder', (box) => writeCatalog(box,
      { extName: { message: 'hi $WHO$', placeholders: { who: { content: '$1' } } } })],
    ['two references sharing a delimiter, both defined', (box) => writeCatalog(box,
      { extName: { message: '$A$$B$',
        placeholders: { a: { content: '$1' }, b: { content: '$2' } } } })],
    ['a placeholder named with an @ in it', (box) => writeCatalog(box,
      { extName: { message: '$A@B$', placeholders: { 'a@b': { content: '$1' } } } })],
    ['a description that is not text',
      (box) => writeCatalog(box, { extName: { message: 'x', description: 7 } })],
    ['an example that is not text', (box) => writeCatalog(box,
      { extName: { message: 'x $A$', placeholders: { a: { content: '$1', example: 7 } } } })],
    ['two names differing only in case', (box) => writeCatalog(box,
      { extName: { message: 'x' }, EXTNAME: { message: 'y' } })],
    ['a catalog answering for a name under @@', (box) => {
      writeCatalog(box, { extName: { message: 'x' }, '@@custom': { message: 'y' } });
      editManifest(box, m => { m.description = '__MSG_@@custom__'; });
    }],
    // The extension id is the catalog's to answer for: Chrome does not supply
    // it to the manifest, and refusing the name outright would take this too.
    ['a catalog answering for the extension id, asked for in the manifest', (box) => {
      writeCatalog(box,
        { extName: { message: 'x' }, '@@extension_id': { message: 'y' } });
      editManifest(box, m => { m.description = '__MSG_@@extension_id__'; });
    }],
    // A candidate that is not a name is passed over rather than refused, so a
    // reference whose name ends in a newline names nothing at all. It goes in
    // a stylesheet because the manifest is read as the JSON text it is, where
    // a newline is written as an escape and never reaches a candidate.
    // Chrome reads both files with a byte order mark and with comments, and
    // reads neither the // in a URL nor the /* in a message as one.
    ['a byte order mark on the manifest', (box) => {
      const text = fs.readFileSync(`${box}/manifest.json`, 'utf8');
      fs.writeFileSync(`${box}/manifest.json`, '\uFEFF' + text);
    }],
    ['a byte order mark on the catalog', (box) => {
      const text = fs.readFileSync(`${box}/_locales/ja/messages.json`, 'utf8');
      fs.writeFileSync(`${box}/_locales/ja/messages.json`, '\uFEFF' + text);
    }],
    ['a line comment in the manifest', (box) => {
      const text = fs.readFileSync(`${box}/manifest.json`, 'utf8');
      fs.writeFileSync(`${box}/manifest.json`, '{\n  // what this is\n' + text.slice(1));
    }],
    ['a line comment in the catalog', (box) => fs.writeFileSync(
      `${box}/_locales/ja/messages.json`,
      '{\n  // the name\n  "extName": { "message": "x" }\n}')],
    ['a block comment in the catalog', (box) => fs.writeFileSync(
      `${box}/_locales/ja/messages.json`,
      '{\n  /* the name */\n  "extName": { "message": "x" }\n}')],
    // The manifest is walked as the values it decoded to: a reference inside a
    // comment is one Chrome dropped before parsing, a reference spelled with
    // escapes is one it decoded, and an object key is not a field it localizes.
    ['a reference nothing answers, inside a line comment', (box) => {
      const text = fs.readFileSync(`${box}/manifest.json`, 'utf8');
      fs.writeFileSync(`${box}/manifest.json`,
        '{\n  // "description": "__MSG_absent__"\n' + text.slice(1));
    }],
    ['a reference nothing answers, inside a block comment', (box) => {
      const text = fs.readFileSync(`${box}/manifest.json`, 'utf8');
      fs.writeFileSync(`${box}/manifest.json`,
        '{\n  /* "description": "__MSG_absent__" */\n' + text.slice(1));
    }],
    ['the extension id inside a comment', (box) => {
      const text = fs.readFileSync(`${box}/manifest.json`, 'utf8');
      fs.writeFileSync(`${box}/manifest.json`,
        '{\n  // "description": "__MSG_@@extension_id__"\n' + text.slice(1));
    }],
    ['a reference spelled with escapes that the catalog answers', (box) => {
      writeCatalog(box, { extName: { message: 'x' }, absent: { message: 'y' } });
      appendRaw(box, '"description":"__MSG_\\u0061bsent__"');
    }],
    ['a reference in an object key rather than a value',
      (box) => editManifest(box, m => { m['__MSG_absent__'] = 'x'; })],
    ['a comment opener inside a string value', (box) => {
      editManifest(box, m => { m.homepage_url = 'https://example.com/*'; });
      // The escaped quote is the point: a scanner that does not step over it
      // ends the string early and reads the // after it as a comment.
      writeCatalog(box, { extName: { message: 'a \" b // c /* d' } });
    }],
    ['a reference whose candidate is not a name', (box) => {
      fs.writeFileSync(`${box}/styles.css`, 'body { content: "__MSG_abc\n__" }\n');
      editManifest(box, m => {
        m.content_scripts = [{ js: ['content.js'], css: ['styles.css'] }];
      });
    }],
    ['the extension id asked for in capitals from a stylesheet', (box) => {
      fs.writeFileSync(`${box}/styles.css`,
        'body { background: url("__MSG_@@EXTENSION_ID__") }\n');
      editManifest(box, m => {
        m.content_scripts = [{ js: ['content.js'], css: ['styles.css'] }];
      });
    }],
    // The three sides of the version rule that a stricter one would refuse.
    // Without these, refusing every version would stay green.
    ['a version of four parts',
      (box) => editManifest(box, m => { m.version = '1.0.0.0'; })],
    ['a leading zero in a part that is not the first',
      (box) => editManifest(box, m => { m.version = '1.01.0'; })],
    ['a version part at the largest number one holds',
      (box) => editManifest(box, m => { m.version = '4294967295'; })],
    // The shape a prerelease takes: Chrome reads the version and shows the
    // name. Without this the rule above would refuse the only shape that
    // lets the prerelease branch of the release grammar build anything.
    ['a prerelease named beside the version Chrome reads', (box) => {
      editManifest(box, m => {
        m.version = '1.2.0';
        m.version_name = '1.2.0-rc1';
      });
    }],
    // Naming nothing has nothing to do with spelling: Chrome takes a pattern
    // that matches no file, so this does too.
    ['a resource pattern that names nothing', (box) => {
      fs.mkdirSync(`${box}/images`);
      fs.writeFileSync(`${box}/images/logo.png`, 'x');
      editManifest(box, m => {
        m.web_accessible_resources = [{ resources: ['images/*.svg'],
          matches: ['https://example.com/*'] }];
      });
    }],
    // The spelling is compared, not folded: a name the tree really carries
    // in capitals is the name that opens it. Without this the rule above
    // could refuse every reference and stay green.
    ['a name the tree carries in capitals', (box) => {
      fs.renameSync(`${box}/content.js`, `${box}/Content.js`);
      editManifest(box, m => { m.content_scripts = [{ js: ['Content.js'] }]; });
    }],
    // The Norwegian the store does carry, which is the name an extension
    // reaching for nb is told to use instead. Without this the rule above
    // could refuse every locale and stay green.
    ['a locale the store carries under a name of its own', (box) => {
      fs.renameSync(`${box}/_locales/ja`, `${box}/_locales/no`);
      editManifest(box, m => { m.default_locale = 'no'; });
    }],
    // Without these two the rules above could refuse every locale that is not
    // the default one, and every region the store spells in capitals, and stay
    // green.
    ['a second locale the store carries',
      (box) => fs.cpSync(`${box}/_locales/ja`, `${box}/_locales/en`, { recursive: true })],
    // Beside the catalog the locale already carries. Without this the rule
    // above could refuse every packaged name under _locales — the catalogs
    // themselves among them — and stay green.
    ['a referenced file beside the catalog of the locale it sits in', (box) => {
      fs.writeFileSync(`${box}/_locales/ja/icon.png`, 'png');
      editManifest(box, m => { m.action = { default_icon: '_locales/ja/icon.png' }; });
    }],
    ['a locale the store spells with its region in capitals', (box) => {
      fs.renameSync(`${box}/_locales/ja`, `${box}/_locales/en_GB`);
      editManifest(box, m => { m.default_locale = 'en_GB'; });
    }],
    // Outside the fields Chrome localizes, a reference is not a reference:
    // the string reaches the browser as it stands, a file name included.
    ['a content script named like a message', (box) => {
      fs.renameSync(`${box}/content.js`, `${box}/__MSG_absent__.js`);
      editManifest(box, m => {
        m.content_scripts = [{ js: ['__MSG_absent__.js'] }];
      });
    }],
    ['a reference in a field Chrome leaves as it stands',
      (box) => editManifest(box, m => { m.author = { email: '__MSG_absent__' }; })]
  ]) {
    const box = buildMinimal();
    arrange(box);
    const listed = runPack(box, ['--list']);
    assert(listed.status === 0,
      `${shape} packs — ${(listed.stderr || '').trim()}`);
    fs.rmSync(box, { recursive: true, force: true });
  }

  // A message Chrome defines itself needs no catalog entry. Without this the
  // rule above could refuse every @@ name and stay green.
  {
    const box = buildMinimal();
    editManifest(box, (m) => { m.description = '__MSG_@@ui_locale__'; });
    const listed = runPack(box, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    fs.rmSync(box, { recursive: true, force: true });
  }

  // Asking for no message, an extension needs no catalog and no locale name.
  // Without this the contract above could refuse everything and stay green.
  {
    const box = buildMinimal();
    fs.rmSync(path.join(box, '_locales'), { recursive: true });
    editManifest(box, (m) => { delete m.default_locale; m.name = 'Plain'; });
    const listed = runPack(box, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort(),
      ['LICENSE', 'content.js', 'manifest.json']);
    fs.rmSync(box, { recursive: true, force: true });
  }

  // Resolving every name answers for one that is missing; reading one can still
  // fail. What the package built last is worth is that it stays.
  const entriesIn = (zip) => spawnSync('python3',
    ['-c', 'import zipfile,sys;print(len(zipfile.ZipFile(sys.argv[1]).namelist()))', zip],
    { encoding: 'utf8' }).stdout.trim();
  for (const unreadable of ['LICENSE', '_locales/ja/messages.json']) {
    const box = buildMinimal();
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    const zip = path.join(box, zipName('0.0.0'));
    const before = fs.statSync(zip).size;
    const entries = entriesIn(zip);
    fs.chmodSync(path.join(box, unreadable), 0o000);
    let denied = true;
    try { fs.readFileSync(path.join(box, unreadable)); denied = false; } catch { /* denied */ }
    if (!denied) {
      // Running as a user the mode does not stop, so the case cannot be made.
      console.log(`  (read-failure check skipped: ${unreadable} is readable at mode 000)`);
      fs.chmodSync(path.join(box, unreadable), 0o644);
      fs.rmSync(box, { recursive: true, force: true });
      continue;
    }
    const failed = runPack(box, []);
    fs.chmodSync(path.join(box, unreadable), 0o644);
    assert.notEqual(failed.status, 0, `pack.py fails when ${unreadable} cannot be read`);
    assert.ok(fs.existsSync(zip) && fs.statSync(zip).size === before,
      `the package built before survives a read failure on ${unreadable}`);
    assert.equal(entriesIn(zip), entries,
      `the package built before still carries ${entries} entries`);
    assert.deepEqual(fs.readdirSync(box).filter((name) => name.endsWith('.part')), [],
      'a half-built package is not left beside the one that stands');
    fs.rmSync(box, { recursive: true, force: true });
  }

  // A name the walk reaches and the locale sweep or DISTRIBUTION_FILES reaches
  // too. zipfile writes the second entry and warns on stderr, which the release
  // path does not read.
  {
    const box = buildMinimal();
    const manifest = JSON.parse(fs.readFileSync(path.join(box, 'manifest.json'), 'utf8'));
    manifest.web_accessible_resources = [
      { resources: ['LICENSE', '_locales/ja/messages.json'], matches: ['*://*/*'] }
    ];
    fs.writeFileSync(path.join(box, 'manifest.json'), JSON.stringify(manifest));
    const listed = runPack(box, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    const names = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    assert.equal(names.length, new Set(names).size, `each name enters the package once`);
    fs.rmSync(box, { recursive: true, force: true });
  }

  // A package built twice from the same files is the same package. Beyond a
  // file's name and bytes a zip entry carries the time the host last wrote it
  // and the mode the host holds it under, and a checkout supplies both afresh
  // — so an archive taking either from the tree differs on every run, and the
  // zip a release uploaded cannot be built again and compared.
  {
    const digestOf = (stamp, mode, edit) => {
      const box = buildMinimal();
      if (edit) { edit(box); }
      for (const name of ['manifest.json', 'content.js', 'LICENSE',
        '_locales/ja/messages.json']) {
        fs.chmodSync(path.join(box, name), mode);
        fs.utimesSync(path.join(box, name), stamp, stamp);
      }
      const built = runPack(box, []);
      assert.equal(built.status, 0, built.stderr);
      const digest = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(box, zipName('0.0.0'))))
        .digest('hex');
      fs.rmSync(box, { recursive: true, force: true });
      return digest;
    };
    const plain = digestOf(946684800, 0o644, null);
    assert.equal(plain, digestOf(1700000000, 0o755, null),
      'the same files build the same package, whatever time and mode the host holds them under');
    // Without this the rule above would hold for a packer writing one archive
    // whatever it was given.
    assert.notEqual(plain, digestOf(946684800, 0o644, (box) =>
      fs.writeFileSync(path.join(box, 'content.js'), '// a line the other build has not got\n')),
    'the package still answers for what the files hold');
  }

  // Read back rather than inferred: the host an entry says it came from is
  // filled in from the host that ran the packer where it is not written, and
  // this suite runs on one host.
  {
    const box = buildMinimal();
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    const read = spawnSync('python3', ['-c',
      'import sys, zipfile\n'
      + 'for held in zipfile.ZipFile(sys.argv[1]).infolist():\n'
      + '    print(held.filename, held.date_time, held.create_system,'
      + ' oct(held.external_attr >> 16))',
      zipName('0.0.0')], { cwd: box, encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr);
    const entries = read.stdout.trim().split(/\r?\n/).filter(Boolean);
    assert.ok(entries.length > 0, 'the package has entries to read');
    for (const entry of entries) {
      assert.match(entry, / \(1980, 1, 1, 0, 0, 0\) 3 0o100644$/,
        `every entry is written under one time, one host and one mode — ${entry}`);
    }
    fs.rmSync(box, { recursive: true, force: true });
  }

  // zipfile fills an entry's create_system in from sys.platform where the
  // entry has not got one, so the host that runs the packer decides it and the
  // check above reads only this host's answer. Reading it on another host is
  // out of reach here; the reading itself is flipped instead.
  {
    const box = buildMinimal();
    const asWindows = spawnSync('python3', ['-B', '-c',
      'import sys, importlib.util, zipfile\n'
      + 'spec = importlib.util.spec_from_file_location("packmod", "pack.py")\n'
      + 'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n'
      + 'sys.platform = "win32"\n'
      // Without this the run below would prove nothing on a host where the
      // default is 3 already.
      + 'assert zipfile.ZipInfo("x").create_system == 0, "the reading did not flip"\n'
      + 'mod.pack()\n'
      + `for held in zipfile.ZipFile(${JSON.stringify(zipName('0.0.0'))}).infolist():\n`
      + '    print("entry", held.filename, held.create_system)'],
    { cwd: box, encoding: 'utf8' });
    assert.equal(asWindows.status, 0, asWindows.stderr);
    const hosts = asWindows.stdout.split(/\r?\n/)
      .map((line) => line.match(/^entry (.+) (\d+)$/)).filter(Boolean);
    assert.ok(hosts.length > 0, 'the package has entries to read');
    for (const [, name, host] of hosts) {
      assert.equal(host, '3', `${name} names one host whatever host packed it`);
    }
    fs.rmSync(box, { recursive: true, force: true });
  }

  // What a run says it packed. The refusals above assert that no line of this
  // shape is printed; without one asserting that it is printed when a package
  // is built, renaming the marker would leave every one of them passing over a
  // run that named the whole tree.
  {
    const box = buildMinimal();
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    const named = built.stdout.split(/\r?\n/)
      .map((line) => line.match(/^\s*\+ (.+)$/)).filter(Boolean).map((match) => match[1]);
    const listed = runPack(box, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    const names = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    assert.deepEqual(named.slice().sort(), names.slice().sort(),
      'a run names what it packed');
    const held = heldInZip(box, zipName('0.0.0')).map(([name]) => name);
    assert.deepEqual(named.slice().sort(), held.slice().sort(),
      'what it names is what the archive holds');
    fs.rmSync(box, { recursive: true, force: true });
  }

  // An argument nobody recognised is not an instruction to rewrite the package.
  {
    const box = buildMinimal();
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    const zip = path.join(box, zipName('0.0.0'));
    const stamp = fs.statSync(zip).mtimeMs;
    for (const argument of [['--lst'], ['-l'], ['--help'], ['--list', 'extra']]) {
      const refused = runPack(box, argument);
      assert.notEqual(refused.status, 0, `pack.py refuses ${argument.join(' ')}`);
      assert.doesNotMatch(refused.stdout || '', /^\s*\+ /m,
        `pack.py packs nothing for ${argument.join(' ')}`);
    }
    assert.equal(fs.statSync(zip).mtimeMs, stamp,
      'the package standing there is not rewritten by an argument nobody recognised');
    fs.rmSync(box, { recursive: true, force: true });
  }
});

