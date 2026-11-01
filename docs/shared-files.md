# The shared files

[日本語](shared-files.ja.md)

What each file under `shared/` does in an extension. Each extension's own documents describe what it gives these files and how it uses them, and point here for the rest. Which files an extension takes, and how a change reaches it, are in the [README](../README.md).

<a id="shared-code"></a>
## The shared code: `core/common.js`

A classic script each extension loads ahead of its own scripts, wherever its `utils.js` loads (the popup, the settings page, the content script and the service worker), so its top-level declarations are globals there. What differs between the extensions — the storage area and keys, the message types, a table of writes, the elements of a page — is passed in by the caller.

<a id="settings"></a>
### Settings

- `SETTINGS_KEY`, `DEFAULT_TARGET_LUFS`, `MIN_TARGET_LUFS` / `MAX_TARGET_LUFS` (-30, -6), `DEFAULT_SHOW_GAIN_OVERLAY` (true), `DEFAULT_AUTO_APPLY_LOUDNESS` (false): the key the settings object is kept under, the Target LUFS default and its range, whether the gain is shown beside the player's volume where the settings hold no choice, and whether Auto is on for a type where neither the owner's row nor the settings name a choice.
- `readSettings`, `isStoredSettingsObject`: the settings object in sync, or the copy in local while sync holds none. Where local comes back empty too, sync is read once more: the two reads can straddle a move (sync read empty, then the move writes sync and clears local), and that read finds what the move put in sync. `{}` where neither area holds a settings object (an object, neither null nor an array).
- `moveSettingsToSync`: settings an earlier version kept in local, moved to sync. Where sync already holds settings — another Chrome the user is signed in to moved first, with Chrome sync on — those stay and the local copy goes. Sync is written before local is removed, so a reader always finds one of the two, and a move sync refuses leaves local as it was for the next try. It reads sync before it writes it, so a settings save landing between the two is overwritten with local's copy (a caller that saves settings runs its saves and the move on one queue); two moves at once that read the same copy in local, and get the same from `keep`, write the same value. The caller's `keep` gives what of local's settings is written. It answers whether local held anything; where it holds nothing, the move is one read.
- `createSerialQueue`: work run one after the other, past a failure, each answered as it settles.
- `writeSettingsChange`, `sameStoredSettings`, `settingCheck`: a change of the settings read, written into sync unless the read and sync hold that already; a table's own check for a field, and nothing for any other name.

<a id="stored-map"></a>
### The owners' map and its rows

- `createStoredMapWriter`: a writer of a map kept in `storage.local` under a key (the extension's owners and their gains), on a queue of its own, so each write reads what the one before it left and a failed write does not stop the next. A write reads the map, hands it to `mutate` to change in place, and writes it back where it changed — where the map, after the change, serialises differently from what was read (an absent key read as `{}`); `extraKeys`, where given, are written alongside, whatever `mutate` did. A context that can no longer reach the runtime writes nothing.
- `MIN_GAIN` / `MAX_GAIN` (0, 6), `clampGain`, `isStorableGain`: the gain range, and the gains a write may store (a finite number within it).
- `storedGain`, `expandLegacyGain`, `hasTypedGain`: a row's gain per type; an earlier single gain is read, and copied on a write, only where no typed field is a key, and only where it is a finite number.
- `applyEntryName`: names a row from the name a write carries. A name that is no text, is empty, or is the id itself (a sender gives the id before it knows the name) leaves the row's name as it is; a row with no name takes the id where `nameNewRow` (true unless the caller says otherwise) says so.
- `expandLegacyAutoFlag`, `autoFlagFor`: an earlier all-types Auto flag fills only the types without a flag of their own; a type's Auto state is its own flag, then the earlier one, then off where the caller's `storedGainTurnsOff` holds (its rule that a gain stored without a flag is a choice of its own), then the default.
- `setAutoFlag`, `hasAutoFlag`: sets a type's Auto flag, true or false, after turning the earlier flag into one per type of the caller's fields; whether a row names an Auto choice for a type — its own flag, or the earlier one (own properties alone).
- `isRowKey`, `rowLabel`: the key a delete may name (non-empty text); what a row is shown and sorted under (its name where that is non-empty text, its key otherwise).

<a id="writes"></a>
### Writes the worker makes for other contexts

- `createWriteListener`: the service worker's runtime message listener for the writes other contexts ask for. The caller's `route` gives the write a message asks for, as `{ write, label, failed }`, or none. What the write resolves to is answered with `ok: true`. A rejection is answered with `ok: false` and the reason it names — `invalid-mutation` for a `WriteRefused`, or any other `reason` the rejection carries — or `failed` where it names none (a storage failure), and logged under the caller's prefix and the write's label (`rejected as invalid`, `blocked by the stored state` for `stored-state-invalid`, `failed` otherwise). A message that asks for no write is left unanswered, so another context's listener can answer it, and logged unless its type is one of `ignoredTypes`.
- `tableWrite`: the write of the table a type names after the caller's prefix.
- `requestWrite`: a page's or a tab's request for a write: the worker's answer once it lands, a rejection with the reason it answered otherwise (`write not confirmed` where it gave none).

<a id="gain"></a>
### Gain

- `isContextValid`: whether the extension's runtime can still be reached.
- `isMediaPlaying`: whether media is neither paused nor muted; a volume or a gain of 0 still counts as playing.
- `isManualGainLocked`: whether Auto holds the gain, so the manual controls take nothing: Auto is on and the level it follows is known.
- `createUnaskedWriteReporter`: a reporter of the writes a page makes that no gesture asked for, each made again by the next one of its kind. Each name keeps a stretch of its own: the first failure is logged at info, the next at error and then nothing more, and a write of that name that lands ends the stretch; nothing is logged where the runtime can no longer be reached.
- `gainToPercent`, `percentToGain`, `gainToDb`, `formatGain`, `formatGainText`, `formatAutoGain`: a gain as a percent or in dB and back, as a number and a unit in the display unit, as one text, and as Auto shows it (`Auto (—)` where no gain is stored).
- `gainForLevel`: the gain that takes a level to the target, `10^((target - level) / 20)` within the gain range, and 1 where that is not finite.
- `AUTO_FOLLOW_INTERVAL_MS` (1000 ms): how often, at most, Auto sets the gain from a level that moves while it plays.

<a id="pages"></a>
### Pages

- `msg`, `applyI18n`, `esc`: a catalog message, or the key where the catalog has none; each `data-i18n` element filled with its message and `<html lang>` set from `pageLanguage`; text made safe between tags and inside a quoted attribute.
- `revealPage`: reads the layout (`document.body.offsetWidth`), so what was written is laid out while transitions are off, then takes `body.initializing` off on the next frame; taken off in the same style pass, the value from before the write would be the transitions' starting point.
- `runPageLoad`, `PAGE_LOAD_TIMEOUT_MS` (3 s): a page's first load, failed where it rejects or has not settled in time, with the page shown once it is answered.

<a id="sliders"></a>
### Slider gestures

- `SLIDER_VALUE_KEYS`, `isSliderMoveKey`, `createSliderKeys`: the arrow keys, PageUp / PageDown and Home / End — the keys that move a range input's value, and the only keys a key hold is made of; any other key takes no part. `createSliderKeys` tracks those down on one slider: the `keydown` of such a key begins a hold where none of them is down (a repeat, or a key pressed while another is down, begins none), and the `keyup` of the last of them ends it.
- `holdSettingsSlider`: one write per key hold or drag on a settings page slider. During a gesture the slider moves its label alone. A key hold writes once, at the `keyup` of the last value key or at a `blur` of the slider or of the window that comes first, where a key moved the value; the `change` of each repeat writes nothing. A drag with the primary button writes at its `change`. A key hold that moved nothing, a drag let go of on the value it began on, and a `blur` that ends a gesture draw the stored value. A press of the pointer during a key hold leaves the hold and its value to the key. After a `blur` that ended a gesture, `input` and `change` move nothing until the next press of the pointer or of a value key, and the `change` draws the stored value. A drag the browser cancels (`pointercancel`) ends the same way with no write, unless a key is held through it. A `blur` with neither a key nor the pointer held ends nothing. A drag's release is taken on the slider, which holds the pointer it was pressed with wherever it is let go. It answers whether a key or the pointer is held.
- `holdPopupSlider`, `PREVIEW_KEEP_ALIVE_MS` (1 s): one save per key hold or drag on the popup's gain slider, heard while it moves. A gesture begins at a press of the primary button or of a value key on the slider, or at an `input` or a `change` with none in progress (the caller's `begin` is told). Each `input` draws the value and, where `canPreview` holds, sends it as a preview; while the pointer or a key stays held after a preview not yet saved, the preview is sent again every `PREVIEW_KEEP_ALIVE_MS`, and no more once it is saved. A drag saves at its `change`. A key hold saves once, at the `keyup` of the last value key, where a key moved the value; the `change` of each repeat saves nothing. A press of the pointer during a key hold leaves the hold to the key; once the key has saved, the press stays the same gesture, and its `change` saves what it moved to after the key, and nothing where it moved nothing more. A `blur` of the slider or of the window ends the gesture, a key hold saving there where a key moved the value; after it `input` and `change` send nothing until the next press, and the `change` puts the thumb back to the value it held at the `blur`. A drag the browser cancels ends the same way with no save, unless a key is held through it, and draws nothing: the tab puts back the gain it holds once the previews stop, and the caller's `cancel` is told. A `blur` with neither a key nor the pointer held ends nothing, and a drag's release is taken on the slider, as on a settings slider. It answers whether a key or the pointer is held.

<a id="settings-page"></a>
### The settings page

- `showSettingsError`: `#settingsError`, shown with a catalog message or hidden.
- `saveSettingOrRestore`: a control's save. Nothing is written before the page has loaded. Where the write lands, the error line goes; where it does not, the page reads the settings again and draws what they hold (unless a settings change came while that read was out) and shows `settingsSaveFailed`, or, where that read fails as well, leaves the controls as they were drawn and shows `settingsLoadFailed`. It logs `<prefix> setting not saved`, and `<prefix> settings not read back after a failed save` where the read fails. It answers whether the save landed.

<a id="popup"></a>
### The popup

- `setCardValue`, `setUnknown`: a card's value, its unit in a `span.unit` and its classes; `---` with the classes and `unknown`.
- `STATE_POLL_INTERVAL_MS`, `pollTabState`: the first ask at once, then the state every second while the popup is open.
- `sendTabMessage`: the popup's message to its tab, refused where it holds none.
- `createSaveNotice`: the notice that a gain is not saved, raised by the answer to the latest save sent for the owner shown where it is not ok, and taken down by one that is or by another owner being shown; the answer to an earlier save, or to one sent for another owner, leaves it as it is, and so does a popup that shows no owner. While it is raised, `draw` puts `gainSaveFailed` in the hint, in the `error` colour.
- `drawOwnerName`: the owner's name, or the catalog's not-detected text in the `empty` class, with the full text as its title.
- `isSiteTab`: whether the tab's URL host name is the site's or a subdomain's.
- `showPopupStatus`, `hidePopupStatus`: the status line with the catalog's text in place of the screen, and the screen back.
- `followDisplayUnit`: the display unit read once and followed in sync while the popup is open; a change that came during the read stands over what the read found.
- `bindPresets`: the preset buttons. Each names its percent in `data-vol`; a click, where the caller's `allow` holds, draws that percent on the slider, its value and the current card in the display unit, then hands the percent and its gain to the caller's `pick`.

<a id="measure"></a>
## The measurement: `core/loudness.js` and `audio-worklet.js`

The `measure` group, for an extension that measures the loudness of the media a page plays with the Web Audio API. What an extension tells the meter — which windows an ad holds out, which ones a change of volume skips, which ones it takes back — is decided in the extension's own script; the meter knows the operations, not the reasons for them.

<a id="loudness"></a>
### `core/loudness.js`

A classic script that declares one name, `channelVolumeLoudness`, and reaches for no extension API, so an extension can load it in the page's own world (a content script entry with `"world": "MAIN"`) ahead of the script that measures, as well as in its own. The object it declares and the coefficients it hands out are frozen, so the page it shares a world with cannot change them.

- `K_PRE_48K`, `K_RLB_48K`, `redesignBiquad`, `kForSampleRate`: the BS.1770-4 K-weighting — the pre-filter's high shelf and the RLB high-pass — as written down at 48 kHz; a biquad taken to another rate through its analog form (inverse bilinear transform at the rate it was written for, bilinear transform at the new one); the two filters for a rate, the written ones within 1 Hz of 48 kHz and designed again otherwise.
- `meanSquareToLufs`: `-0.691 + 10 log10(ms)`, and `-Infinity` for anything that is not a finite number above 0.
- `normalizeForVolume`: a block tapped ahead of an element's own volume, divided by the volume squared where the volume is between 0 and 1 (both left out), and left as it is otherwise.
- `WORKLET_PROCESSOR`, `buildChain`: the name `audio-worklet.js` registers its processor under; the chain from a source node through the two filters for the context's rate to an `AudioWorkletNode` of that processor, with `onBlock` as its port's message handler, and from it into a gain of 0 connected to the destination, so the measurement adds nothing to the output. It answers the worklet node. The caller has loaded `audio-worklet.js` into the context before.
- `BLOCK_SEC` (0.1 s), `MOMENTARY_BLOCKS` (4), `SHORT_BLOCKS` (30), `GATE_BLOCKS` (4), `MAX_INTEGRATED_BLOCKS` (36000, an hour of windows), `MIN_SEED_WINDOWS` (300) and `MAX_SEED_WINDOWS` (1800), `BOUNDARY_SKIP_BLOCKS` (4): the block the worklet is asked for, the blocks Momentary and Short-term are read over, the blocks of a gating window (BS.1770-4's 400 ms windows overlapping by 75%: one window per block), the windows the ring holds, the bounds of a seed, and the windows a boundary keeps out.
- `createMeter`: one measurement.
  - `addBlock(ms, hold)`: a block from the worklet, already referenced to the level it is measured at. It answers `momentary` and `shortTerm` (the mean of the last 4 and 30 blocks, or of all there are, as LUFS), `window` (the mean of the last 4 blocks, the gating window this block completes, or `null` before there are 4), `skipped` (whether the boundary skip took the window) and `integrated` (`{ lufs, windows }`). A window is observed, and numbered from 1 since the last reset, whatever happens to it. Under `hold` it is not appended and the boundary skip stays where it is; otherwise, while a boundary skip runs, the skip takes it and counts down; otherwise it is appended to the ring, which gives back its oldest entry once it holds `MAX_INTEGRATED_BLOCKS`, and indexed where it is at or above the absolute gate (-70 LUFS).
  - The Integrated level is the mean of the indexed windows at or above the relative gate, 10 LU under the mean of the index, and `-Infinity` where the index holds none. Its `windows` are the windows inside the relative gate, with the seed's entries standing for the count the seed was given where the seed is inside both gates, and held to `MAX_SEED_WINDOWS`. The index is a balanced tree carrying each subtree's sum and count, so the gate is read in O(log n) whatever order the levels come in.
  - `reset(lufs, windows)`: empties the blocks and the ring and numbers the windows from 1 again. Where `lufs` is a finite level whose mean square is finite, the seed is laid down as `max(MIN_SEED_WINDOWS, claimed)` entries numbered 0, where `claimed` is `windows` held to `MAX_SEED_WINDOWS` where it is a positive safe integer, and 0 otherwise. A seed under the absolute gate stays out of the index. A boundary skip in progress runs on.
  - `clearBlocks()`: the next gating window starts from the next block; Integrated is kept.
  - `skipBoundary()`, `boundaryWindowsLeft()`: the next `BOUNDARY_SKIP_BLOCKS` windows that are not held stay out of Integrated, counted again from the full number where a skip is already running; and how many of them are left.
  - `windowsObserved()`, `windowsSinceReset()`: the windows formed since the last reset; and those of them appended and not removed since.
  - `appendedWindowsSince(first)`: how many of the newest entries of the ring came from window `first` or later, counting from the newest back to the first that did not.
  - `removeRecentWindows(count)`: takes up to `count` of the newest entries out of the ring and the index, never more than `windowsSinceReset()` or what the ring holds, so a seed's entries are never taken. It answers the mean square of each, oldest first.

<a id="worklet"></a>
### `audio-worklet.js`

The `k-mean-square` processor. Over each block of `processorOptions.blockSec` seconds at the context's rate (0.1 s where that is not a number above 0, and 64 samples at least) it posts `{ ms, samples }`, the mean of L² + R²; a mono input counts its one channel on both sides. A render quantum that brings no input keeps the part of the block already measured. An extension that loads it into a page's context lists it in `web_accessible_resources`.

<a id="mutation"></a>
## The mutation sweep: `tools/mutation/`

What holds a suite to more than being green. `equivalents.md` beside these scripts is each repository's own record and is not shared.

- `sweep.mjs <tree> <source> <test command…>` turns a source into mutants by rule, runs the suite against each and reports the ones that live through it. A mutant that does not parse is left out of the count; the source is put back after every run and read again, and a source that did not come back leaves the marker over the tree and a non-zero exit. A run of the suite that takes longer than 180 s is stopped and its mutant reported as HUNG; the sweep stops the command it started, not what that command started, so a suite that starts processes of its own is run through `bail.mjs`. Settings, by environment variable:
  - `MUTATE_LINES=<first>-<last>`: the mutants whose site falls inside those lines; the control still runs against the whole file.
  - `MUTATE_SHARD=<k>/<n>`: every nth of those mutants from the kth, so n sweeps in n trees run them between them, each with its own control and baseline.
  - `MUTATE_COUNT=1`: how many runs the sweep would make, writing nothing and running nothing.
  - `MUTATE_CONFIRM=<shell line>`: a second suite, run on the survivors alone.
  - `MUTATE_OPTIONAL=1`: the optional-chaining rule as well.
  - `MUTATE_TIMEOUT_MS=<n>`: each run given n ms in place of 180 s.
- `sweep.mjs --verify [<tree>]` writes nothing and runs no suite: it asks whether every entry of `equivalents.md` still names a mutant the code has.
- `bail.mjs <pattern> <test command…>` runs a suite in a process group of its own and ends the run with exit 1 at the first line it prints that matches the pattern, so a mutant the suite kills costs the time to its first failure. That stop takes the whole group, and the suite's own clean-up does not run. A signal that reaches the run (Ctrl-C, the sweep's timeout) is passed to the group, what is left of it is killed once the suite has ended, and the run ends by that signal. A run no line matches ends as the suite ended, and what the suite started and left running is not stopped. A run it stops as failed is one the suite would have ended with a failure too, except where the suite, after printing that line, would have exited 0 or never ended: the sweep counts those as standing without `bail.mjs` and as killed with it. It refuses to run on Windows (exit 2), which has no process groups.
- `sweep-all.sh <tree> <report> <suite command> <file>…` sweeps each file in turn into one report, and stops where a sweep stopped rather than leaving an empty section.

<a id="coverage"></a>
## The coverage report: `tools/coverage/v8-to-lcov.mjs`

`v8-to-lcov.mjs <coverage dir> <lcov out> <source>…` turns the coverage V8 leaves under `NODE_V8_COVERAGE` into an lcov report of the sources named. A source is counted from every script compiled from it, whatever context loaded it — a `file:` URL naming its own path, any other URL ending in its name — and not from a script whose text is not as long as it. A line counts as run where any of its code ran, and is reported as a branch left untaken where some of it did not; blank lines and lines holding only a comment are not reported, and a named source nothing loaded is reported with every line unrun. The shared `ci.yaml` names the JS files `pack.py --list` ships but those under `core/` and `audio-worklet.js`, which this repository's suite covers.

<a id="package"></a>
## The package and the icons: `pack.py`, `gen_icons.py`

- `pack.py` builds the zip for the Chrome Web Store from what the extension loads: the manifest, everything it names, what those pages and workers pull in, and the locale files; a file nothing references is not packed, but for `LICENSE`, which is packed always and whose absence stops the build. `--list` prints the selection and writes no zip. Everything under `_locales/` sits in a directory named, in its spelling, by the locale list the Chrome Web Store publishes, with a `messages.json` of its own. Every entry is written under one time, one mode and one host, so the same files build the same zip on any machine. The zip is named after `core.json`'s `package`.
- `gen_icons.py` draws the icons (16, 48 and 128 px) in the colours and with the mark `core.json`'s `icon` names. It needs pillow, and exits 3 without it.

<a id="check-shared"></a>
## The check of the copies: `tools/check-shared.sh`

Fetches the commit `core.json` locks from this repository and runs that commit's `sync.mjs --check`, which exits 1 naming each shared file that differs, is missing or changed its executable bit. The repository is named in the script rather than read from the tree; `CORE_SOURCE` names another one to fetch from.

<a id="release"></a>
## Releases: the `release` group

- `tag-release.yaml` runs when CI passes on a push to `main`. Where the commit moved the version in `manifest.json` (`version_name` where it has one, `version` otherwise) from its first parent, `tools/tag-plan.sh` names the tag `v<version>` — asked of `tools/check-tag.sh`, with the manifest asked of `tools/verify-version.sh`, before anything is pushed — which is pushed, and `release.yaml` is dispatched on it: merging a version bump is the release. A tag of that name at another commit fails the job and is not moved.
- `release.yaml` runs on a release tag: `tools/check-tag.sh` refuses a tag that names no release this workflow makes (`vN.N.N`, or that with `-beta` / `-rc` / `-alpha`), and a run on a branch makes none; the tests run, `tools/verify-version.sh` holds the tag to the manifest (`version_name` where it has one, which has to be `version` or `version` followed by `-`, and `version` otherwise), and the package is built and attached to a draft GitHub Release.

<a id="workflows"></a>
## The other workflows

- `ci.yaml`: on a push to `main`, a pull request to it and by hand — the Python syntax check, the check of the copies, the extension's suites (`test.js`, `test-navigation.js` and `test-screenshots.py` where it has them), the screenshot check where it has one, and the coverage report uploaded to Codecov.
- `sync-core.yaml`: the daily pull request that takes this repository's `main` ([README](../README.md#changing-a-shared-file)).
- `dependabot-auto-merge.yml` and its test: auto-merge for a patch or minor update Dependabot alone wrote.
- `.gitattributes` checks every shared file out with LF line endings.
