// pack.test.cjs — pack.py packs what the extension loads and nothing else,
// follows every manifest key that names a file, refuses a reference it cannot
// pack, and names the zip after the package core.json names.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  shared, PACKAGE, zipName, writeCore, withFixtureDir, SYMLINK_SKIP, heldInZip, namesOnWindows
} = require('./helpers.cjs');

const PACK = shared('pack.py');

// Directories an extension's root holds session artifacts in rather than
// extension files. pack.py keeps them out of the store package too.
const SCRATCH_DIRS = ['work', '.claude'];

const runPack = (box, args) => spawnSync('python3', ['-B', 'pack.py', ...args],
  { cwd: box, encoding: 'utf8' });
const listedBy = (run) => run.stdout.split('\n').map((line) => line.trim()).filter(Boolean);

// The tree carries a link to content.js under a name nothing references when
// `withLinks` is set.
function packsOnlyWhatLoads(withLinks) {
  // pack.py runs for real here: a declaration read out of its source would
  // still pass with the selection that uses it deleted.
  withFixtureDir('cv-pack-', (fixture) => {
    // Each file carries its own path as its text, so an entry standing for
    // another file reads as a different digest below.
    const write = (relative, body = relative) => {
      const target = path.join(fixture, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    };
    write('manifest.json', JSON.stringify({
      manifest_version: 3,
      version: '1.0.0',
      default_locale: 'ja',
      content_scripts: [{ js: ['utils.js', 'content.js'] }],
      web_accessible_resources: [{ resources: ['audio-worklet.js'] }],
      background: { service_worker: 'worker.js' },
      options_page: 'options.html',
      action: { default_popup: 'popup.html', default_icon: { 16: 'icons/icon16.png' } }
    }));
    write('utils.js');
    write('content.js');
    write('audio-worklet.js');
    // Two arguments, spelled two ways: a walk that stops at the first one
    // leaves the second out of the package with nothing saying so. The
    // background.js below is in the tree and named by nothing, so which of
    // the two is packed says the selection follows references.
    write('worker.js',
      'importScripts(\'channel-store.js\', "lib/second.js");\n');
    write('channel-store.js');
    write('lib/second.js');
    // Spellings a browser reads alike. The expected list below is written out
    // by hand rather than scanned, so it does not inherit whatever this page's
    // markup happens to exercise.
    write('popup.html',
      '<script src="utils.js"></script>\n'
      + '<SCRIPT SRC="popup.js"></SCRIPT>\n'
      + "<script src='sub/deep.js'></script>\n"
      + '<script src=bare.js></script>\n'
      + '<script  src = "spaced.js" ></script>\n'
      + '<link rel="stylesheet" href="popup.style">\n'
      + '<link href="popup.css">\n'
      + '<!-- <script src="commented.js"></script> -->\n');
    write('bare.js');
    write('spaced.js');
    write('popup.style');
    write('popup.css');
    write('commented.js');
    write('sub/deep.js');
    // The page options_page names, and what it pulls in: a script under sub/
    // and a stylesheet by rel. Nothing else reaches any of the three, so they
    // are packed only where options_page is followed and its page is read.
    write('options.html',
      '<script src="options.js"></script>\n'
      + "<script src='sub/options-deep.js'></script>\n"
      + '<link rel="stylesheet" href="options.style">\n');
    write('options.js');
    write('sub/options-deep.js');
    write('options.style');
    write('LICENSE', 'MIT License\n');
    write('popup.js');
    write('icons/icon16.png');
    write('_locales/ja/messages.json', '{}');
    write('_locales/en/messages.json', '{"a":{"message":"b"}}');
    writeCore(fixture);

    // Nothing references these, whatever their extension says.
    const seeded = ['commented.js', 'core.json'];
    const seed = (relative, body) => {
      write(relative, body);
      seeded.push(relative);
    };
    seed('review-probe.js');
    seed('notes.html', '<p>notes</p>');
    seed('.env', 'TOKEN=secret');
    seed('.DS_Store', '');
    seed('review-notes.txt');
    seed('README.md');
    seed('README.ja.md');
    seed('CLAUDE.md');
    seed('PRIVACY_POLICY.md');
    seed('gen_icons.py');
    seed('gen_screenshots.py');
    seed('test.js');
    seed('test-screenshots.py');
    seed('background.js', '');
    // The archive this build writes, already there under its name, and one
    // left from another build under a name of its own.
    seed(zipName('1.0.0'));
    seed(`${PACKAGE}-1.0.0-old.zip`, '');
    seed('.git', 'gitdir: /elsewhere');
    seed('.github/workflows/ci.yaml');
    seed('tools/check-shared.sh');
    seed('tools/mutation/sweep.mjs');
    seed('icons/source.svg');
    seed('_locales/ja/notes.txt');
    seed('docs/screenshots/popup_en.png');
    seed('docs/screenshots/popup_ja.png');
    seed('node_modules/_cache/index.js');
    seed('__pycache__/content.cpython-314.pyc', '');
    if (withLinks) {
      fs.symlinkSync(path.join(fixture, 'content.js'), path.join(fixture, 'linked.js'));
      seeded.push('linked.js');
    }
    for (const name of SCRATCH_DIRS) seed(path.posix.join(name, 'session', '_metadata', 'note.txt'));
    fs.copyFileSync(PACK, path.join(fixture, 'pack.py'));
    seeded.push('pack.py');
    assert.ok(!seeded.includes('LICENSE'), 'the licence is expected in the zip, not kept out of it');

    const listed = runPack(fixture, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    const packaged = listedBy(listed);
    const expected = [
      'LICENSE',
      '_locales/en/messages.json',
      '_locales/ja/messages.json',
      'audio-worklet.js',
      'bare.js',
      'channel-store.js',
      'content.js',
      'icons/icon16.png',
      'lib/second.js',
      'manifest.json',
      'options.html',
      'options.js',
      'options.style',
      'popup.css',
      'popup.html',
      'popup.js',
      'popup.style',
      'spaced.js',
      'sub/deep.js',
      'sub/options-deep.js',
      'utils.js',
      'worker.js'
    ];
    assert.deepEqual(packaged.slice().sort(), expected.slice().sort());
    const onWindows = namesOnWindows(fixture, 'the fixture');
    if (onWindows) {
      assert.deepEqual(onWindows.slice().sort(), expected.slice().sort(),
        'the fixture packs the same names on either host');
    }

    // The names say nothing about what is under them: a packer writing empty
    // entries under these names passes every assertion above. This builds the
    // archive and reads it.
    const built = runPack(fixture, []);
    assert.equal(built.status, 0, built.stderr);
    const held = heldInZip(fixture, zipName('1.0.0'));
    assert.deepEqual(held.map(([name]) => name).sort(), expected.slice().sort());
    for (const name of seeded) {
      assert.ok(!held.some(([entry]) => entry === name || entry.startsWith(name + '/')),
        `pack.py keeps ${name} out of the store zip`);
    }
    for (const [name, digest] of held) {
      const onDisk = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(fixture, ...name.split('/')))).digest('hex');
      assert.equal(digest, onDisk, `${name} in the package is the file of that name`);
    }
    // Without this the comparison above would hold for a packer that wrote
    // nothing at all, since an empty entry matches an empty file.
    const ofNothing = crypto.createHash('sha256').update('').digest('hex');
    assert.ok(held.some(([, digest]) => digest !== ofNothing),
      'the fixture gives the packer something to get wrong');
  });
}

test('the store package carries only the files the extension loads',
  () => packsOnlyWhatLoads(false));

test('the store package leaves out a link nothing references', { skip: SYMLINK_SKIP },
  () => packsOnlyWhatLoads(true));

// Every key that names a file is followed, a page is read for what it pulls in
// whatever it is called, and a stylesheet is read for what it reaches.
test('the package follows every manifest key that names a file', () => {
  withFixtureDir('cv-keys-', (fixture) => {
    const write = (relative, body = relative) => {
      const target = path.join(fixture, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    };
    write('manifest.json', JSON.stringify({
      manifest_version: 3,
      version: '1.0.0',
      // One path rather than a size for each: the other spelling Chrome takes.
      action: { default_popup: 'popup.htm', default_icon: 'brand.png' },
      options_ui: { page: 'options.html' },
      icons: { 16: 'icons/small.png', 48: 'icons/large.png' },
      devtools_page: 'devtools.html',
      side_panel: { default_path: 'panel.html' },
      chrome_url_overrides: { newtab: 'newtab.html' },
      sandbox: { pages: ['sandboxed.html'] },
      storage: { managed_schema: 'schema.json' },
      declarative_net_request: {
        rule_resources: [{ id: 'r', enabled: true, path: 'rules.json' }]
      },
      content_scripts: [{ js: ['content.js'], css: ['styles.css'] }],
      web_accessible_resources: [
        { resources: ['exposed.js', '/loose.png', '//spare.js', '/',
                      'images/*.png', '/lib/*.js'],
          matches: ['https://example.com/*'] }
      ]
    }));
    // Chrome loads a page under whatever name the key gives it.
    write('popup.htm', '<script src="popup.js"></script>\n');
    write('popup.js');
    write('options.html');
    write('icons/small.png');
    write('icons/large.png');
    write('devtools.html');
    write('panel.html');
    write('newtab.html');
    write('sandboxed.html');
    write('schema.json', '{}');
    write('rules.json', '[]');
    write('content.js');
    write('exposed.js');
    write('styles.css', '@import "theme.css";\n'
      + 'body { background: url(bg.png) }\n'
      + '/* url(commented.png) */\n'
      + 'a { background: url("https://example.com/remote.png") }\n'
      + 'b { background: url(#within) }\n'
      + 'c { background: url("__MSG_@@extension_id__/asset.png") }\n');
    write('theme.css', 'body { color: red }\n');
    write('bg.png');
    write('brand.png');
    // In a comment, remote, a fragment of the sheet, and a name Chrome
    // substitutes a message into: none of them is a file this can resolve.
    write('commented.png');
    // A resource entry is a pattern Chrome matches against the extension's
    // own files, so what it names is packed. The three beside it are the
    // ones it does not name: a different extension, a different directory,
    // and one the pattern reaches only because '*' passes over a slash.
    write('images/logo.png');
    write('images/deep/inner.png');
    write('images/notes.txt');
    // The pattern has to name the whole of what it matches: this one begins
    // with a name it does name and goes on past it.
    write('images/logo.png.bak');
    // Where a pattern names files exactly, those are the files it names:
    // this one folds onto it and is not among them.
    write('images/OTHER.PNG');
    // What a pattern names is read by what it is: this one imports, and
    // what it imports is packed with it.
    write('lib/helper.js', "importScripts('inner.js');\n");
    write('lib/inner.js');
    write('lib/notes.txt');
    // A resource is written from the extension's root, and the documented
    // form writes that root as a leading slash: '/loose.png' and '/lib/*.js'
    // name what 'loose.png' and 'lib/*.js' name. A slash on its own names
    // nothing, and one written twice is still the root.
    write('loose.png');
    write('spare.js');
    write('stray.png');
    write('LICENSE', 'MIT License\n');
    fs.copyFileSync(PACK, path.join(fixture, 'pack.py'));

    const listed = runPack(fixture, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      listedBy(listed).sort(),
      [
      'LICENSE', 'bg.png', 'brand.png', 'content.js', 'devtools.html', 'exposed.js',
      'icons/large.png', 'icons/small.png', 'images/deep/inner.png',
      'images/logo.png', 'lib/helper.js', 'lib/inner.js', 'loose.png',
      'manifest.json', 'newtab.html', 'options.html', 'panel.html', 'popup.htm',
      'popup.js', 'rules.json', 'sandboxed.html', 'schema.json', 'spare.js',
      'styles.css', 'theme.css'
    ]);

    // The other spelling of an icon for the action: a size for each rather than
    // one path. Chrome takes both — measured against 151, which packs a manifest
    // carrying options_ui, icons and a per-size default_icon together — so the
    // walk has a row for each and both are put to it.
    {
      const at = (name) => path.join(fixture, name);
      const manifest = JSON.parse(fs.readFileSync(at('manifest.json'), 'utf8'));
      manifest.action.default_icon = { 16: 'brand16.png', 48: 'brand48.png' };
      fs.writeFileSync(at('manifest.json'), JSON.stringify(manifest));
      write('brand16.png');
      write('brand48.png');
      const sized = runPack(fixture, ['--list']);
      assert.equal(sized.status, 0, sized.stderr);
      const names = listedBy(sized);
      for (const name of ['brand16.png', 'brand48.png']) {
        assert.ok(names.includes(name), `the package follows a per-size icon: ${name}`);
      }
      // The one path the manifest no longer names. Without this the check above
      // would pass over a walk that packed the tree.
      assert.ok(!names.includes('brand.png'),
        'the icon the manifest stopped naming is left out');
      // Put the tree back the way the checks below expect it.
      fs.writeFileSync(at('manifest.json'), JSON.stringify(
        { ...manifest, action: { ...manifest.action, default_icon: 'brand.png' } }));
      fs.rmSync(at('brand16.png'));
      fs.rmSync(at('brand48.png'));
    }

    // Each of these says the key was walked rather than the file happening to
    // be carried some other way.
    // A pattern cannot name a file that is not there, so what says it was
    // matched is that the file is in the list above and its neighbours are
    // not. These are the names that fail when the key stops being walked.
    for (const gone of ['panel.html', 'rules.json', 'schema.json', 'theme.css',
      'bg.png', 'brand.png', 'exposed.js', 'popup.js', 'lib/inner.js',
      'options.html', 'icons/small.png']) {
      fs.rmSync(path.join(fixture, gone));
      const refused = runPack(fixture, ['--list']);
      assert.notEqual(refused.status, 0, `pack.py refuses a package missing ${gone}`);
      assert.match(refused.stderr, new RegExp(gone.replace('.', '\\.')));
      write(gone);
    }
  });
});

test('a reference naming a drive is refused under Windows path semantics', () => {
  // A drive letter reads as relative to posixpath, and on Windows it resolves
  // against the same drive — so `C:/content.js` would package what `content.js`
  // names, under a path Chrome does not accept. On this host it merely misses,
  // which is why the reference is put to pack.py under Windows path semantics.
  const driveProbe = [
    'import ntpath, os, builtins, types, importlib.util',
    'spec = importlib.util.spec_from_file_location("packmod", "pack.py")',
    'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'real, real_open, real_os = os.path, builtins.open, os',
    'ROOT = "C:" + chr(92) + "repo"',
    'here = real.realpath(".")',
    'host = lambda p: p.replace(ROOT, here).replace(chr(92), "/")',
    'win = lambda p: p.replace(here, ROOT).replace("/", chr(92))',
    'class W:',
    '    isabs, normpath, join, dirname = ntpath.isabs, ntpath.normpath, ntpath.join, ntpath.dirname',
    '    realpath = staticmethod(lambda p: win(real.realpath(host(p))))',
    '    isfile = staticmethod(lambda p: real.isfile(host(p)))',
    '    isdir = staticmethod(lambda p: real.isdir(host(p)))',
    '    abspath = staticmethod(lambda p: win(real.abspath(host(p))))',
    'mod.os = types.SimpleNamespace(path=W, listdir=lambda p: real_os.listdir(host(p)),',
    '                               remove=real_os.remove, sep=chr(92))',
    'mod.open = lambda p, *a, **k: real_open(host(p), *a, **k)',
    'for name in ["content.js", "C:/content.js", "C:content.js", "c:content.js"]:',
    '    print(name, mod._resolve(ROOT, name) is not None)'
  ].join('\n');
  // The package the probe resolves against: a copy of pack.py and the one
  // file the references name.
  withFixtureDir('cv-drive-', (box) => {
    fs.copyFileSync(PACK, path.join(box, 'pack.py'));
    fs.writeFileSync(path.join(box, 'content.js'), '');
    const run = spawnSync('python3', ['-B', '-c', driveProbe],
      { cwd: box, encoding: 'utf8' });
    if (run.error) {
      console.log(`  (drive-letter check skipped: ${run.error.message})`);
      return;
    }
    assert.equal(run.status, 0, `the drive-letter probe runs — ${(run.stderr || '').trim()}`);
    const answers = Object.fromEntries((run.stdout || '').trim().split(/\r?\n/)
      .filter(Boolean).map((line) => line.split(' ')));
    assert.equal(answers['content.js'], 'True',
      'a path inside the package still resolves under Windows path semantics');
    for (const named of ['C:/content.js', 'C:content.js', 'c:content.js']) {
      assert.equal(answers[named], 'False', `${named} names a drive and is refused`);
    }
  });
});

test('a misspelled reference is named as one where realpath folds case', () => {
  // Windows answers realpath with the spelling the tree holds. This host may
  // not, so realpath is made to answer that way here.
  const foldingProbe = [
    'import importlib.util, os',
    'spec = importlib.util.spec_from_file_location("packmod", "pack.py")',
    'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'real = os.path.realpath',
    'def folded(p):',
    '    drive, rest = os.path.splitdrive(real(p))',
    '    at = drive + os.sep',
    '    for part in [name for name in rest.split(os.sep) if name]:',
    '        held = os.listdir(at) if os.path.isdir(at) else []',
    '        if part not in held:',
    '            part = next((n for n in held if n.lower() == part.lower()), part)',
    '        at = os.path.join(at, part)',
    '    return at',
    'os.path.realpath = folded',
    'assert folded(os.path.join(os.getcwd(), "Content.js")) != os.path.join(os.getcwd(), "Content.js")',
    'for name in ["content.js", "Content.js"]:',
    '    try:',
    '        mod._packaged(os.getcwd(), name)',
    '        print(name, "packed")',
    '    except SystemExit as refusal:',
    '        print(name, refusal)'
  ].join('\n');
  withFixtureDir('cv-folded-', (fixture) => {
    fs.copyFileSync(PACK, path.join(fixture, 'pack.py'));
    fs.writeFileSync(path.join(fixture, 'content.js'), '');
    const run = spawnSync('python3', ['-B', '-c', foldingProbe], { cwd: fixture, encoding: 'utf8' });
    assert.equal(run.status, 0, `the folding probe runs — ${(run.stderr || '').trim()}`);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/), [
      'content.js packed',
      'Content.js the tree spells this another way: Content.js'
    ]);
  });
});

// The cases that reach outside through a symbolic link run when `withLinks` is set.
function refusesWhatLeaves(withLinks) {
  // A path that resolves outside the package would carry a file nobody
  // reviewed into the store zip under a name that looks local.
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const outside = fs.mkdtempSync(path.join(tmpRoot, 'cv-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.js'), 'SECRET');
  fs.writeFileSync(path.join(outside, 'messages.json'), '{}');

  const run = (build) => {
    let result;
    // The package sits one level down: a case that reaches outside it with ..
    // writes into its own parent, never into the shared temp root.
    withFixtureDir('cv-escape-', (parent) => {
      const fixture = path.join(parent, 'package');
      fs.mkdirSync(fixture);
      fs.copyFileSync(PACK, path.join(fixture, 'pack.py'));
      build(fixture);
      result = runPack(fixture, ['--list']);
    });
    return result;
  };
  const manifest = (references, extra = {}) => JSON.stringify({
    manifest_version: 3,
    version: '1.0.0',
    content_scripts: [{ js: references }],
    ...extra
  });

  try {
    if (withLinks) {
      // A symlinked parent directory: only the last name looks local.
      const throughParent = run((fixture) => {
        fs.writeFileSync(path.join(fixture, 'manifest.json'), manifest(['linked/secret.js']));
        fs.symlinkSync(outside, path.join(fixture, 'linked'));
      });
      assert.notEqual(throughParent.status, 0);
      assert.match(throughParent.stderr, /linked\/secret\.js/);
    }

    const climbing = run((fixture) => {
      fs.writeFileSync(path.join(fixture, 'manifest.json'), manifest(['../secret.js']));
      const sibling = path.join(path.dirname(fixture), 'secret.js');
      // The climb has to land inside this case's own directory.
      assert.ok(sibling.startsWith(fs.realpathSync(tmpRoot) + path.sep));
      assert.notEqual(path.dirname(sibling), fs.realpathSync(tmpRoot));
      fs.writeFileSync(sibling, 'SIBLING');
    });
    assert.notEqual(climbing.status, 0);
    assert.match(climbing.stderr, /\.\.\/secret\.js/);

    // Absolute and pointing at a path with no link anywhere in it: the only
    // thing standing between it and the zip is the rule against absolute paths.
    assert.equal(fs.realpathSync(outside), outside);
    const absolute = run((fixture) => {
      fs.writeFileSync(
        path.join(fixture, 'manifest.json'),
        manifest([path.join(outside, 'secret.js')])
      );
    });
    assert.notEqual(absolute.status, 0);
    assert.match(absolute.stderr, /secret\.js/);

    if (withLinks) {
      // The locale directories are listed rather than referenced, and one of
      // them can be a link just as easily.
      const linkedLocaleDir = run((fixture) => {
        fs.writeFileSync(path.join(fixture, 'manifest.json'),
          manifest([], { default_locale: 'ja' }));
        fs.mkdirSync(path.join(fixture, '_locales'));
        fs.symlinkSync(outside, path.join(fixture, '_locales', 'ja'));
      });
      assert.notEqual(linkedLocaleDir.status, 0);
      assert.match(linkedLocaleDir.stderr, /_locales\/ja\/messages\.json/);

      const linkedLocaleRoot = run((fixture) => {
        fs.writeFileSync(path.join(fixture, 'manifest.json'),
          manifest([], { default_locale: 'ja' }));
        fs.symlinkSync(outside, path.join(fixture, '_locales'));
      });
      assert.notEqual(linkedLocaleRoot.status, 0);
      assert.match(linkedLocaleRoot.stderr, /_locales\//);
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

test('the store package refuses a reference that leaves it', () => refusesWhatLeaves(false));

test('the store package refuses a link that leaves it', { skip: SYMLINK_SKIP },
  () => refusesWhatLeaves(true));

// The cases where a link stands in for a file it packs run when `withLinks` is set.
function refusesWhatItCannotPack(withLinks) {
  withFixtureDir('cv-pack-missing-', (fixture) => {
    const writeManifest = (extra = {}) => fs.writeFileSync(
      path.join(fixture, 'manifest.json'), JSON.stringify({
        manifest_version: 3,
        version: '1.0.0',
        content_scripts: [{ js: ['content.js'] }],
        ...extra
      }));
    writeManifest();
    fs.copyFileSync(PACK, path.join(fixture, 'pack.py'));

    // A zip built around a missing file is a broken extension, not a smaller one.
    const missing = runPack(fixture, ['--list']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /content\.js/);
    if (!withLinks) return;

    // A referenced symlink resolves outside the package: it is not packed
    // silently in place of the file it points at.
    fs.writeFileSync(path.join(fixture, 'elsewhere.js'), '//');
    fs.symlinkSync(path.join(fixture, 'elsewhere.js'), path.join(fixture, 'content.js'));
    const linked = runPack(fixture, ['--list']);
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /content\.js/);

    // The locale files are found rather than referenced, and get the same rule.
    // A _locales directory has to be named by a default_locale, so this case
    // names one to reach the rule it is about.
    writeManifest({ default_locale: 'ja' });
    fs.unlinkSync(path.join(fixture, 'content.js'));
    fs.writeFileSync(path.join(fixture, 'content.js'), '//');
    fs.mkdirSync(path.join(fixture, '_locales', 'ja'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'messages-elsewhere.json'), '{}');
    fs.symlinkSync(
      path.join(fixture, 'messages-elsewhere.json'),
      path.join(fixture, '_locales', 'ja', 'messages.json')
    );
    const linkedLocale = runPack(fixture, ['--list']);
    assert.notEqual(linkedLocale.status, 0);
    assert.match(linkedLocale.stderr, /messages\.json/);
  });
}

test('the store package refuses a reference it cannot pack',
  () => refusesWhatItCannotPack(false));

test('the store package refuses a link where a file it packs belongs', { skip: SYMLINK_SKIP },
  () => refusesWhatItCannotPack(true));

// ── core.json: the name the zip carries ─────────────────────────────────────

// A package of three files beside a copy of pack.py, under `parent/package`,
// with core.json holding `config` where one is given. A zip written by a name
// that climbs out lands in `parent`, which goes with the case.
function packageBox(parent, config) {
  const box = path.join(parent, 'package');
  fs.mkdirSync(box);
  fs.copyFileSync(PACK, path.join(box, 'pack.py'));
  fs.writeFileSync(path.join(box, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '1.2.3',
    content_scripts: [{ js: ['content.js'] }]
  }));
  fs.writeFileSync(path.join(box, 'content.js'), 'content.js');
  fs.writeFileSync(path.join(box, 'LICENSE'), 'MIT License\n');
  if (config !== undefined) writeCore(box, config);
  return box;
}

// Every archive and every half-built one under the case's directory, by its
// path below it.
function archivesUnder(parent) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(zip|part)$/.test(entry.name)) found.push(path.relative(parent, full).split(path.sep).join('/'));
    }
  };
  walk(parent);
  return found.sort();
}

test('the zip is named after the package core.json names, then the version', () => {
  for (const config of [
    // The shape an extension's core.json has: the package beside the keys the
    // other tools read.
    { core: { groups: ['base', 'release'], commit: 'a'.repeat(40) }, package: PACKAGE,
      icon: { background: [24, 24, 27], accent: [145, 70, 255], letter: 'T' } },
    { package: 'another-package' },
    // The edges of the spelling: one character, digits alone, and digits
    // between hyphens.
    { package: 'x' },
    { package: '7' },
    { package: 'a1-b2-c3' }
  ]) {
    const name = config.package;
    withFixtureDir('cv-name-', (parent) => {
      const box = packageBox(parent, config);
      const built = runPack(box, []);
      assert.equal(built.status, 0, `${name} packs — ${built.stderr}`);
      assert.deepEqual(archivesUnder(parent), [`package/${name}-1.2.3.zip`],
        `the zip for ${name} carries its name and the version, and nothing else is written`);
      const said = built.stdout.match(/^=> (.+)$/m);
      assert.equal(said && said[1], `${name}-1.2.3.zip`, `the run names the zip it wrote for ${name}`);
      assert.deepEqual(heldInZip(box, `${name}-1.2.3.zip`).map(([entry]) => entry).sort(),
        ['LICENSE', 'content.js', 'manifest.json'], `the zip for ${name} holds the package`);
    });
  }
});

test('a tree with no core.json is not packed, and the zip built before stays', () => {
  withFixtureDir('cv-no-config-', (parent) => {
    const box = packageBox(parent, { package: PACKAGE });
    const first = runPack(box, []);
    assert.equal(first.status, 0, first.stderr);
    const zip = path.join(box, zipName('1.2.3'));
    const before = fs.readFileSync(zip);
    fs.rmSync(path.join(box, 'core.json'));
    // A build that went through would write different bytes.
    fs.writeFileSync(path.join(box, 'content.js'), 'content.js, changed');
    const refused = runPack(box, []);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /^core\.json is not readable: /m);
    assert.doesNotMatch(refused.stderr, /Traceback \(most recent call last\)/);
    assert.doesNotMatch(refused.stdout, /^\s*\+ /m, 'nothing is named as packed');
    assert.deepEqual(archivesUnder(parent), [`package/${zipName('1.2.3')}`],
      'no other zip and no half-built one is written');
    assert.ok(before.equals(fs.readFileSync(zip)), 'the zip built before is left as it was');
  });
});

test('a core.json naming no package the zip can be called by is refused', () => {
  // The fourth entry, where a case carries one, is the repr the refusal names.
  for (const [what, config, named] of [
    ['a package that is not text', { package: 7 }, '7'],
    ['a package written as true', { package: true }, 'True'],
    ['a package written as null', { package: null }, 'None'],
    ['a package written as a list', { package: [PACKAGE] }, `['${PACKAGE}']`],
    ['no package at all', { core: { groups: ['base'] } }, 'None'],
    ['a top level that is not an object', [PACKAGE], 'None'],
    ['a package in capitals', { package: 'Cv-Fixture' }, "'Cv-Fixture'"],
    ['a package with a capital inside it', { package: 'cv-Fixture' }, "'cv-Fixture'"],
    ['a package with a space', { package: 'cv fixture' }, "'cv fixture'"],
    ['a package beginning with a hyphen', { package: '-cv-fixture' }, "'-cv-fixture'"],
    ['a package ending with a hyphen', { package: 'cv-fixture-' }, "'cv-fixture-'"],
    ['two hyphens together', { package: 'cv--fixture' }, "'cv--fixture'"],
    ['an empty package', { package: '' }, "''"],
    ['a package with an underscore', { package: 'cv_fixture' }, "'cv_fixture'"],
    ['a package with a dot', { package: 'cv.fixture' }, "'cv.fixture'"],
    ['a package naming a directory', { package: 'cv/fixture' }, "'cv/fixture'"],
    ['a package that climbs out of the tree', { package: '../cv-fixture' }, "'../cv-fixture'"],
    ['a package ending in a newline', { package: 'cv-fixture\n' }, "'cv-fixture\\n'"],
    ['a package outside ASCII', { package: 'cv-ﬁxture' }, "'cv-ﬁxture'"]
  ]) {
    withFixtureDir('cv-bad-name-', (parent) => {
      const box = packageBox(parent, { package: PACKAGE });
      const first = runPack(box, []);
      assert.equal(first.status, 0, first.stderr);
      const zip = path.join(box, zipName('1.2.3'));
      const before = fs.readFileSync(zip);
      writeCore(box, config);
      const refused = runPack(box, []);
      assert.equal(refused.status, 1, `pack.py refuses ${what} — ${refused.stderr}`);
      assert.ok(refused.stderr.includes(`core.json names no package to call the zip by: ${named}\n`),
        `pack.py names what is wrong with ${what} — ${refused.stderr}`);
      assert.doesNotMatch(refused.stderr, /Traceback \(most recent call last\)/,
        `pack.py says what is wrong with ${what}, instead of raising`);
      assert.doesNotMatch(refused.stdout, /^\s*\+ /m, `pack.py names nothing as packed with ${what}`);
      assert.deepEqual(archivesUnder(parent), [`package/${zipName('1.2.3')}`],
        `no zip is written for ${what}, and none half-built`);
      assert.ok(before.equals(fs.readFileSync(zip)), `the zip built before stays with ${what}`);
    });
  }

  // A core.json that does not read as JSON is said to be that, not a name.
  withFixtureDir('cv-bad-name-', (parent) => {
    const box = packageBox(parent);
    fs.writeFileSync(path.join(box, 'core.json'), `{ "package": "${PACKAGE}", }`);
    const refused = runPack(box, []);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /^core\.json is not readable as JSON: /m);
    assert.doesNotMatch(refused.stderr, /Traceback \(most recent call last\)/);
    assert.deepEqual(archivesUnder(parent), [], 'no zip is written');
  });
});

test('core.json is never packed', () => {
  withFixtureDir('cv-config-', (parent) => {
    const box = packageBox(parent, {
      core: { groups: ['base'], commit: 'a'.repeat(40) }, package: PACKAGE,
      icon: { background: [0, 0, 0], accent: [255, 255, 255], letter: 'X' }
    });
    const listed = runPack(box, ['--list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listedBy(listed).sort(), ['LICENSE', 'content.js', 'manifest.json'],
      'the list leaves core.json out');
    const built = runPack(box, []);
    assert.equal(built.status, 0, built.stderr);
    assert.ok(!/^\s*\+ core\.json$/m.test(built.stdout), 'the build names no core.json as packed');
    assert.deepEqual(heldInZip(box, zipName('1.2.3')).map(([entry]) => entry).sort(),
      ['LICENSE', 'content.js', 'manifest.json'], 'the zip holds no core.json');
  });
});
