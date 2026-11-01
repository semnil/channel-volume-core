# The shared files

[日本語](shared-files.ja.md)

What each file under `shared/` does in an extension. Each extension's own documents describe what it gives these files and how it uses them, and point here for the rest. Which files an extension takes, and how a change reaches it, are in the [README](../README.md).

<a id="shared-code"></a>
## The shared code: `core/common.js`

A classic script each extension loads ahead of its own scripts, wherever its `utils.js` loads (the popup, the settings page, the content script and the service worker), so its top-level declarations are globals there. What differs between the extensions — the storage area and keys, the message types, a table of writes, the elements of a page — is passed in by the caller.

<a id="settings"></a>
### Settings

- `SETTINGS_KEY`, `DEFAULT_TARGET_LUFS`, `MIN_TARGET_LUFS` / `MAX_TARGET_LUFS` (-30, -6): the key the settings object is kept under, the Target LUFS default and its range.
- `readSettings`, `isStoredSettingsObject`: the settings object in sync, the copy in local while sync holds none, sync again where local comes back empty, and `{}` where neither area holds a settings object.
- `moveSettingsToSync`: settings an earlier version kept in local, moved to sync where sync holds none, then taken out of local; it answers once local is clear, and a failure as its own.
- `createSerialQueue`: work run one after the other, past a failure, each answered as it settles.
- `writeSettingsChange`, `sameStoredSettings`, `settingCheck`: a change of the settings read, written into sync unless the read and sync hold that already; a table's own check for a field, and nothing for any other name.

<a id="stored-map"></a>
### The owners' map and its rows

- `createStoredMapWriter`: a map in `storage.local` (the extension's owners and their gains), written back where it changed, one write at a time on a queue of its own, and nothing where the runtime cannot be reached.
- `MIN_GAIN` / `MAX_GAIN` (0, 6), `clampGain`, `isStorableGain`: the gain range, and the gains a write may store (a finite number within it).
- `storedGain`, `expandLegacyGain`, `hasTypedGain`: a row's gain per type; an earlier single gain is read, and copied on a write, only where no typed field is a key, and only where it is a finite number.
- `applyEntryName`: a name of its own, never the id, replaces the row's; a row with none takes the id where the caller asks for it.
- `expandLegacyAutoFlag`, `autoFlagFor`: an earlier all-types Auto flag fills only the types without a flag of their own; a type's Auto state is its own flag, then the earlier one, then the stored-gain rule, then the default.
- `isRowKey`, `rowLabel`: the key a delete may name (non-empty text); what a row is shown and sorted under (its name where that is non-empty text, its key otherwise).

<a id="writes"></a>
### Writes the worker makes for other contexts

- `createWriteListener`: the service worker's runtime message listener for the writes other contexts ask for. The caller gives the table of writes by message type. A refusal (`WriteRefused`) is answered `invalid-mutation`, a storage failure by the write's own reason, and a message that names no write is left unanswered and logged unless its type is one the caller ignores.
- `tableWrite`: the write of the table a type names after the caller's prefix.
- `requestWrite`: a page's or a tab's request for a write: the worker's answer once it lands, a rejection with the reason it answered otherwise (`write not confirmed` where it gave none).

<a id="gain"></a>
### Gain

- `isContextValid`: whether the extension's runtime can still be reached.
- `gainToPercent`, `percentToGain`, `gainToDb`, `formatGain`, `formatGainText`, `formatAutoGain`: a gain as a percent or in dB and back, as a number and a unit in the display unit, as one text, and as Auto shows it (`Auto (—)` where no gain is stored).
- `gainForLevel`: the gain that takes a level to the target, `10^((target - level) / 20)` within the gain range, and 1 where that is not finite.
- `AUTO_FOLLOW_INTERVAL_MS` (1000 ms): how often, at most, Auto sets the gain from a level that moves while it plays.

<a id="pages"></a>
### Pages

- `msg`, `applyI18n`, `esc`: a catalog message, or the key where the catalog has none; each `data-i18n` element filled with its message and `<html lang>` set from `pageLanguage`; text made safe between tags and inside a quoted attribute.
- `revealPage`: lays out what was written, then takes `body.initializing` off on the next frame.
- `runPageLoad`, `PAGE_LOAD_TIMEOUT_MS` (3 s): a page's first load, failed where it rejects or has not settled in time, with the page shown once it is answered.

<a id="sliders"></a>
### Slider gestures

- `SLIDER_VALUE_KEYS`, `isSliderMoveKey`, `createSliderKeys`: the keys that move a range input's value, which alone make a key hold, and the tracker of those held down on one slider.
- `holdSettingsSlider`: one write per key hold or drag on a settings page slider. A key hold writes at the `keyup` of the last value key, where it moved the value; a drag writes at its `change`; a press of the pointer during a key hold keeps the key's value for its `keyup`; a `blur` ends the gesture, and nothing after it is taken until the next press; a drag the browser cancels writes nothing and draws the stored value.
- `holdPopupSlider`, `PREVIEW_KEEP_ALIVE_MS` (1 s): one save per key hold or drag on the popup's gain slider, previewed as it moves and sent again every second while it is held. A gesture begins at an input with none in progress; a press of the pointer keeps a key hold and its value; a release that comes ahead of the drag's `change` is one gesture with it; a save is made only where an input came after the last one; a `blur` ends the gesture; a cancelled drag saves nothing and leaves what is drawn to the tab (the caller's `cancel` is told).

<a id="settings-page"></a>
### The settings page

- `showSettingsError`: `#settingsError`, shown with a catalog message or hidden.
- `saveSettingOrRestore`: a control's save. Nothing is written before the page has loaded. Where the write lands, the error line goes; where it does not, the page draws what the settings hold (unless a settings change came while that read was out) and shows `settingsSaveFailed`, or `settingsLoadFailed` where that read fails as well.

<a id="popup"></a>
### The popup

- `setCardValue`, `setUnknown`: a card's value, its unit in a `span.unit` and its classes; `---` with the classes and `unknown`.
- `STATE_POLL_INTERVAL_MS`, `pollTabState`: the first ask at once, then the state every second while the popup is open.
- `sendTabMessage`: the popup's message to its tab, refused where it holds none.
- `createSaveNotice`: the notice that a gain is not saved, raised by the answer to the latest save sent for the owner shown where it is not ok, and taken down by one that is or by another owner being shown.
- `drawOwnerName`: the owner's name, or the catalog's not-detected text in the `empty` class, with the full text as its title.
- `isSiteTab`: whether the tab's URL host name is the site's or a subdomain's.
- `showPopupStatus`, `hidePopupStatus`: the status line with the catalog's text in place of the screen, and the screen back.
- `followDisplayUnit`: the display unit read once and followed in sync while the popup is open; a change that came during the read stands over what the read found.
- `bindPresets`: the preset buttons. Each names its percent in `data-vol`; a click, where the caller's `allow` holds, draws that percent on the slider, its value and the current card in the display unit, then hands the percent and its gain to the caller's `pick`.

<a id="mutation"></a>
## The mutation sweep: `tools/mutation/`

What holds a suite to more than being green. `equivalents.md` beside these scripts is each repository's own record and is not shared.

- `sweep.mjs <tree> <source> <test command…>` turns a source into mutants by rule, runs the suite against each and reports the ones that live through it. A mutant that does not parse is left out of the count; the source is put back after every run and read again, and a source that did not come back leaves the marker over the tree and a non-zero exit. A run of the suite that takes longer than 180 s is stopped and its mutant reported as HUNG. Settings, by environment variable:
  - `MUTATE_LINES=<first>-<last>`: the mutants whose site falls inside those lines; the control still runs against the whole file.
  - `MUTATE_SHARD=<k>/<n>`: every nth of those mutants from the kth, so n sweeps in n trees run them between them, each with its own control and baseline.
  - `MUTATE_COUNT=1`: how many runs the sweep would make, writing nothing and running nothing.
  - `MUTATE_CONFIRM=<shell line>`: a second suite, run on the survivors alone.
  - `MUTATE_OPTIONAL=1`: the optional-chaining rule as well.
  - `MUTATE_TIMEOUT_MS=<n>`: each run given n ms in place of 180 s.
- `sweep.mjs --verify [<tree>]` writes nothing and runs no suite: it asks whether every entry of `equivalents.md` still names a mutant the code has.
- `bail.mjs <pattern> <test command…>` runs a suite and ends the run with exit 1 at the first line it prints that matches the pattern, so a mutant the suite kills costs the time to its first failure. A run no line matches ends as the suite ended, and a run a signal took ends by that signal. The suite runs in a process group of its own, which a signal reaching the run is passed to and which is killed once the suite has ended; the suite's own clean-up does not run. It refuses to run on Windows (exit 2), which has no process groups.
- `sweep-all.sh <tree> <report> <suite command> <file>…` sweeps each file in turn into one report, and stops where a sweep stopped rather than leaving an empty section.

<a id="coverage"></a>
## The coverage report: `tools/coverage/v8-to-lcov.mjs`

`v8-to-lcov.mjs <coverage dir> <lcov out> <source>…` turns the coverage V8 leaves under `NODE_V8_COVERAGE` into an lcov report of the sources named. A source is counted from every script compiled from it, whatever context loaded it — a `file:` URL naming its own path, any other URL ending in its name — and not from a script whose text is not as long as it. A line counts as run where any of its code ran, and is reported as a branch left untaken where some of it did not; blank lines and lines holding only a comment are not reported, and a named source nothing loaded is reported with every line unrun. The shared `ci.yaml` names the JS files `pack.py --list` ships but those under `core/`, which this repository's suite covers.

<a id="package"></a>
## The package and the icons: `pack.py`, `gen_icons.py`

- `pack.py` builds the zip for the Chrome Web Store from what the extension loads: the manifest, everything it names, what those pages and workers pull in, and the locale files; a file nothing references is not packed. `--list` prints the selection and writes no zip. Everything under `_locales/` sits in a directory named, in its spelling, by the locale list the Chrome Web Store publishes, with a `messages.json` of its own. Every entry is written under one time, one mode and one host, so the same files build the same zip on any machine. The zip is named after `core.json`'s `package`.
- `gen_icons.py` draws the icons (16, 48 and 128 px) in the colours and with the mark `core.json`'s `icon` names. It needs pillow, and exits 3 without it.

<a id="check-shared"></a>
## The check of the copies: `tools/check-shared.sh`

Fetches the commit `core.json` locks from this repository and runs that commit's `sync.mjs --check`, which exits 1 naming each shared file that differs, is missing or changed its executable bit. The repository is named in the script rather than read from the tree; `CORE_SOURCE` names another one to fetch from.

<a id="release"></a>
## Releases: the `release` group

- `tag-release.yaml` runs when CI passes on a push to `main`. Where the commit moved the version in `manifest.json` (`version_name` where it has one, `version` otherwise) from its first parent, `tools/tag-plan.sh` names the tag `v<version>`, which is pushed, and `release.yaml` is dispatched on it: merging a version bump is the release. A tag of that name at another commit fails the job and is not moved.
- `release.yaml` runs on a release tag: `tools/check-tag.sh` refuses a tag that names no release this workflow makes (`vN.N.N`, or that with `-beta` / `-rc` / `-alpha`), the tests run, `tools/verify-version.sh` holds the tag to the manifest, and the package is built and attached to a draft GitHub Release.

<a id="workflows"></a>
## The other workflows

- `ci.yaml`: on a push to `main`, a pull request to it and by hand — the Python syntax check, the check of the copies, the extension's suites (`test.js`, `test-navigation.js` and `test-screenshots.py` where it has them), the screenshot check where it has one, and the coverage report uploaded to Codecov.
- `sync-core.yaml`: the daily pull request that takes this repository's `main` ([README](../README.md#changing-a-shared-file)).
- `dependabot-auto-merge.yml` and its test: auto-merge for a patch or minor update Dependabot alone wrote.
- `.gitattributes` checks every shared file out with LF line endings.
