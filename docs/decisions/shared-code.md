# Shared-code decisions

[日本語](shared-code.ja.md)

Closed decisions made when the code the extensions had in common was brought into this repository, on 2026-10-31 and 2026-11-01 unless a date says otherwise: what is shared, how it reaches an extension, and which of the forms the extensions had each shared part took. What the shared files do now is in [shared-files.md](../shared-files.md) and the [README](../../README.md).

## What is shared, and what stays in each extension

- **Decision**: the tools are shared (`pack.py`, `tools/mutation/`, the CI and release workflows, `.github/tests/`, `gen_icons.py`), and so are the handling of the popup and the settings page, the saving and syncing of the settings, and the conversion of a gain. What an extension's `content.js` and `page-bridge.js` exchange with their site stays in the extension.
- **Rejected**: sharing the tools alone; merging the extensions into one repository.
- **History**: it was done in three steps — the tools, then the code that could be shared without changing what it does, then the code whose forms differed — each as one pull request here and one in each extension that takes it.

## The shared files live in a public repository of their own

- **Decision**: the shared files are kept in this repository, which is public. A change to a shared part passes a pull request and CI here before it is copied to an extension.
- **Rejected**: making yt-channel-volume the place the others copy from.

## The extensions pull the shared files

- **Decision** (2026-10-31): each extension fetches what it shares. The shared `sync-core.yaml` runs in the extension once a day and by hand; where this repository's `main` has moved past the commit the extension locks, it opens a pull request from `sync/channel-volume-core`. The workflow runs this repository's `sync-core.sh` from a clone of this repository — the script is not among the shared files — and one run at a time. Where the extension allows auto-merge, the pull request merges once its required checks pass ([#5](https://github.com/semnil/channel-volume-core/pull/5), [#6](https://github.com/semnil/channel-volume-core/pull/6)).
- **Decision** (2026-10-31): the push and the pull request are made with a GitHub App's token (the variable `SYNC_APP_CLIENT_ID` and the secret `SYNC_APP_PRIVATE_KEY`; the job is skipped where the variable is not set). The workflow's own `GITHUB_TOKEN` is not used: the code assumes a pull request made with it starts no workflow, so the extension's CI would not run on the copy.

## A sync pull request with nothing left to take loses its branch first

- **Decision** (2026-10-31): where an extension already locks `main` and a pull request from `sync/channel-volume-core` is still open, the run deletes the branch under a lease on the commit it read, and only then closes the pull request, by number, with a comment ([#10](https://github.com/semnil/channel-volume-core/pull/10)).
- **Rejected**: closing the pull request and leaving the branch ([#12](https://github.com/semnil/channel-volume-core/pull/12), closed unmerged). Between reading the branch and closing the pull request there is a gap; a push that lands in it would have its pull request closed, and closing a pull request takes no condition on the commit at its head. Closing, then reading again and reopening where the branch had moved, was rejected with it.
- **Reason**: the repositories delete a head branch on merge, but only for a pull request that merged; one closed unmerged keeps its branch unless the run removes it.

## Dependabot runs here alone

- **Decision** (2026-10-31): the versions of the Actions the shared workflows use are raised here. This repository's `dependabot.yml` covers its own workflows and `shared/.github/workflows`; the extensions carry no `dependabot.yml`, and a raised version reaches them as any other shared change does. The auto-merge workflow stays in the extensions that take it, since it reports the required check `auto-merge`.
- **Rejected**: leaving the workflows unshared, with Dependabot and its auto-merge in each extension.

## The shared code is tested and covered here alone

- **Decision**: the tests of the shared code are here, written with `node:test`, and the mutants they let through are recorded here, not in an extension's record.
- **Decision** (2026-11-01): the tests here alone have to kill every mutant of `core/common.js`, bar those recorded with a reason. Once they did, the shared `ci.yaml` left `core/` out of an extension's coverage report, and the tests an extension carried only to run a shared line were taken out of it ([#42](https://github.com/semnil/channel-volume-core/pull/42), [#43](https://github.com/semnil/channel-volume-core/pull/43)).
- **Rejected**: leaving `core/` out of the extensions' coverage before the tests here could stand alone; counting the shared code both here and in each extension.
- **History**: while the extensions' coverage still counted `core/` (2026-10-31), two rulings held. A shared function an extension does not call was merged with that extension's Codecov checks failing, rather than adding a call to its tests or leaving `core/` out. A branch the extension's own writes cannot reach, inside a function it does call, was not let through the same way: the extension's tests ran it before the merge. Both stopped applying when `core/` left the extensions' coverage.

## Differences between the extensions are unified

- **Decision**: where the extensions did the same thing in different ways, the difference is removed as far as it can be, and every extension takes the one form. A fix that had reached only some of them goes into the rest. A difference that had been left on 2026-10-30 as "each extension as it is" is unified with the others. What belongs to a site is not unified.
- **Rejected**: deciding case by case whether to unify.
- **Reason**: which way each difference is unified is settled by the decisions below, so that it is not asked again; a behaviour the user sees that none of them covers is put as a question.

## The settings list shows `Auto (—)` where Auto is on and no gain is stored

- **Decision**: a row of the settings page's list whose Auto is on and that has no stored gain reads `Auto (—)`, the form yt-channel-volume had.
- **Rejected**: `Auto (100%)`.

## A type with no field of its own has no stored gain

- **Decision**: in a row that holds both the earlier single `gain` and per-type fields, a type whose field is missing is treated as having no stored value. The earlier `gain` is read only where no typed field is a key.
- **Rejected**: using the earlier `gain` for that type.

## A stored gain is 0 to 600%

- **Decision**: a write stores only a finite gain from 0 to 6, the form twitch-channel-volume had. yt-channel-volume clamps the gain it is about to save to that range before it sends it, and the worker accepts nothing outside it.
- **Rejected**: any finite number; no check.
- **History**: yt-channel-volume had decided not to clamp a stored value at 6.0 ([yt-channel-volume #52](https://github.com/semnil/yt-channel-volume/pull/52)). That was withdrawn here, so that every extension holds the one range, over letting yt-channel-volume alone accept more than 600% and over having it refuse such a save.

## A refused or failed popup action raises one notice

- **Decision**: whatever the failure — the action refused, or the save failed — the popup shows `gainSaveFailed` and reads the state again, the form twitch-channel-volume had.
- **Rejected**: telling the user of a failed save only, and reading the state again in silence where the action was refused.

## A drag on the popup's slider is heard as it moves

- **Decision**: while the popup's slider is dragged, the value is played as a preview, and while the button stays down the preview is sent again every second.
- **Rejected**: playing nothing until the slider is let go, in every extension.

## A gesture saves only where it moved the value

- **Decision**: a key let go, or a focus lost, with an unsaved preview still out saves only where the value moved. A preview left out goes back to the stored value two seconds after the input stops.
- **Decision**: the settings page's Target LUFS follows the same rule: where the value came back to where it began during a key hold, a write is made if a key moved the value, and a write of the value already stored is left out by the writer, not by the page comparing values.
- **Rejected**: saving whenever a preview is still out.

## A press of the pointer leaves a key hold to the key

- **Decision**: where the slider is pressed with the pointer while an arrow key is held on it, the hold goes on, and the value the key moved is saved where the key is let go — in the popup and on the settings page alike.
- **Rejected**: ending the hold at the press of the pointer.
- **History**: this replaced a ruling of 2026-10-30 in the gain-state decisions, under which a press of the pointer ended a hold where the code already did so ([gain-state.md](gain-state.md), "A key hold saves once").

## A value key pressed again stays in the hold it is in

- **Decision** (2026-11-01): a value key that is down and is pressed again, not as a repeat, continues the hold. `createSliderKeys().press` answers that a hold begins only where no value key is down ([#28](https://github.com/semnil/channel-volume-core/pull/28)).
- **Rejected**: treating it as a new hold.
- **Reopen when**: whether Chrome ever sends such a `keydown` is not known; the decision stands on either answer.

## A drag's release is taken on the slider

- **Decision** (2026-11-01): the `pointerup` of a drag let go outside the slider is listened for on the slider, in the popup and on the settings page. The code assumes a pressed range input holds the pointer it was pressed with, so the release and the `change` reach it wherever the pointer is let go.
- **Rejected**: listening on the window.

## A popup that cannot read the settings shows the reload screen

- **Decision** (2026-11-01): where the popup's read of the settings fails, it shows the screen it shows when its tab cannot be reached (`#reloadNeeded`).
- **Rejected**: drawing with `%` as the display unit; that, with a notice that the settings could not be read.

## The button of the display unit in use writes nothing

- **Decision**: on the settings page, pressing the button of the unit already chosen makes no write, since a write that changes nothing is left out. An error line raised by a failed save therefore stays when that button is pressed.

## A message the catalog lacks shows its key

- **Decision** (2026-10-31): in the popup and on the settings page, a `data-i18n` element whose message the catalog lacks shows the key, and `<html lang>` is set from the catalog. The text each such element carries in the HTML is the key itself.
- **Rejected**: leaving the HTML's text in place where the catalog has no message.

## A failed delete on the settings page is told with an alert

- **Decision** (2026-10-31): where deleting a row, or all of them, fails, the settings page says so with an `alert`.
- **Rejected**: writing it to the console alone.

## The name a write carries

- **Decision** (2026-10-31): how a write names a row is shared. A name that is not text is dropped and the write goes on; a name that is the id itself does not replace a stored name; a new row with no name takes its id as its name.
- **Rejected**: leaving the naming in each extension.

## An earlier all-types Auto flag fills only the types without one

- **Decision** (2026-10-31): before a write, an earlier flag that stood for every type fills only the types that have no flag of their own, and is then removed, the form twitch-channel-volume had.
- **Rejected**: overwriting every type's flag with the earlier one, the form yt-channel-volume had.

## The worker's listener is shared, and the message types are not

- **Decision** (2026-10-31): the service worker's listener for the writes other contexts ask for is shared (`createWriteListener`): it finds the write a message names, and answers a refusal or a failed save with a `reason`. Each extension keeps its message types and hands the listener its table of writes. A message of a type the listener does not know is logged with `console.warn` and left unanswered, but for the types an extension names to be ignored. The reasons are one set of words in every extension: `invalid-mutation`, `stored-state-invalid`, `storage-update-failed`, `settings-update-failed`.
- **Rejected**: one set of message types for every extension, in either of the two forms in use; not logging an unknown type; each extension keeping its own words for a reason.

## The popup asks for the state every second

- **Decision** (2026-11-01): while it is open, the popup asks its tab for the state every second (`pollTabState`), the form twitch-channel-volume had. The content script sends no state of its own accord, and the key that kept it from sending the same state twice went with that.
- **Rejected**: keeping both ways and adding the Target LUFS to that key; having the content script send the state in every extension.
- **Reason**: with the content script sending, yt-channel-volume's key left the Target LUFS out, and a change of the target while Auto was off sent the popup nothing.

## The gain overlay is on by default

- **Decision** (2026-11-01): where the settings hold no choice, the gain is shown beside the player's volume, in every extension, the form twitch-channel-volume had. A user of yt-channel-volume who had never saved the setting sees the overlay from then on.
- **Decision** (2026-11-01): the default is one constant here, `DEFAULT_SHOW_GAIN_OVERLAY`, read by each extension's content script and settings page. The `checked` of the settings page's HTML stays in the extension, and its tests hold it to the constant ([#48](https://github.com/semnil/channel-volume-core/pull/48)).
- **Rejected**: a default per extension; off in every extension.

## The popup's presets are shared

- **Decision** (2026-11-01): the preset buttons are bound by the shared `bindPresets`, and each names its percent in `data-vol` ([#44](https://github.com/semnil/channel-volume-core/pull/44)).
- **History**: until then they had been left in each extension, which was a placement made without asking and not a decision.
