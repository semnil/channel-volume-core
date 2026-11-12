# Gain-state decisions

[日本語](gain-state.ja.md)

Closed decisions about the paths by which a gain or a setting changes and is saved, made between 2026-10-25 and 2026-10-31 while a set of faults the extensions had in common was repaired: failures that were swallowed, writes that raced, and writes that were repeated for nothing. What those paths do now is in each extension's `docs/gain-change-and-save.md` and in [shared-files.md](../shared-files.md); several of the parts named below have since moved into `core/common.js`. Where a later decision replaced one of these, the section says so.

## The design document changes in the commit that changes the behaviour

- **Decision** (2026-10-25): each extension's `docs/gain-change-and-save.md` and its Japanese counterpart went in with that extension's fixes, and a fix that changes what a path does corrects the document in the same commit.
- **Rejected**: the document first, ahead of the fixes; the document after them, in one piece.

## A failed apply is reported

- **Decision** (2026-10-25): in yt-channel-volume, the chains in `content.js` that carried no `.catch` go to `reportFailure`, as the first apply after a navigation does. `commitGain` changes `currentGain` only once the audio path is connected, and an exception on Auto's path is caught and reported the same way.

## A settings save that fails puts the control back and says so

- **Decision** (2026-10-25): on yt-channel-volume's settings page, a change of the Target LUFS, the gain overlay or the display unit waits for its save. Where the save fails, the control goes back to the stored value and `settingsSaveFailed` is shown, with the wording and the manner twitch-channel-volume already had.
- **Decision** (2026-10-29): where the save fails and the read that follows fails as well, every extension shows `settingsLoadFailed` and not the notice that the stored value was put back, which in that case it was not.
- **Rejected**: putting the control back without a notice, as the toggle of Auto's default did.

## A preview holds off every other gain

- **Decision** (2026-10-25): in yt-channel-volume, while a preview from the popup is playing, a gain that arrives for any other cause is not applied. At the end of the gesture — its `change` or save arriving, or the previews stopping — the content script compares with the newest stored value. After an action that was refused it applies the newest stored value and says so.
- **Decision** (2026-10-25 to 2026-10-28): the gesture is not ended while the button or a key is held: the popup sends the preview again every second, and the content script ends the preview two seconds after the last one reached it.
- **Decision** (2026-10-29): twitch-channel-volume takes the same form. A preview is not re-applied over by a change in storage — its own tab's save of the measurement was putting the stored gain back under a held key — and Auto's gain from the measurement is not applied during a preview.
- **Rejected**: having the popup ignore what arrives; both sides guarding. For the two-second end: playing whatever arrived in the meantime, or the preview, where nothing did; always going back to the stored value. For twitch-channel-volume: holding off until the save arrives, without the resend and the two-second end.

## A change the settings start is made again once where it was overtaken

- **Decision** (2026-10-25): in yt-channel-volume, an apply started by a settings change and dropped because storage moved under it (`storageRevision`) is made once more after the reads settle. A save is not added to each channel notice to cover it.
- **Decision** (2026-10-25): twitch-channel-volume marks, at start-up and at a navigation, that the seeded reset of the measurement is still owed (`seededResetPending`); while the mark stands, whichever re-read wins sends that reset.
- **Decision** (2026-10-25 to 2026-10-28): the mark is also set where an owner event changes what is measured.
- **Decision** (2026-10-25 to 2026-10-28): in twitch-channel-volume too, a re-read started by a settings change that was overtaken is made again once, with its save of Auto's gain, after things settle.
- **Rejected**: leaving the overtaken re-read to the periodic save of the measurement; setting the mark at start-up and navigation alone.

## The settings are written by the service worker, a field at a time

- **Decision** (2026-10-25): yt-channel-volume writes its settings through the service worker's queue, one field at a time, as twitch-channel-volume's `settings-store.js` did.
- **Decision** (2026-10-25 to 2026-10-28): the worker checks what it is asked to write and refuses a Target LUFS out of range, a unit other than `%` or `dB`, and a toggle that is not a boolean.
- **Rejected**: writing without the check.

## A key hold saves once

- **Decision** (2026-10-25): while a key is held on the popup's slider, only previews are sent, and the gain is saved once, at `keyup`. The settings page's Target LUFS likewise changes only its display while a key is held, and writes once at `keyup`. A `blur` with the key still down ends the hold there and saves.
- **Decision** (2026-10-30): only the keys that move a range input's value — the arrow keys, PageUp and PageDown, Home and End — begin a hold and continue it. A Tab pressed during a drag had left the drag unsaved.
- **Decision** (2026-10-30): the value keys that are down are counted, and the save is made once, where the last of them is let go. Letting go of one arrow key while another was held had split the save.
- **Decision** (2026-10-30): the slider of twitch-channel-volume's gain during an ad follows the form of the Target LUFS slider. It had written on every repeat of a held key.
- **Rejected**: having the content script delay the write; leaving a write per repeat.
- **History**: the ruling of 2026-10-30 that a press of the pointer ends a hold where the code already did so was replaced on 2026-10-31: the hold goes on, in every extension ([shared-code.md](shared-code.md), "A press of the pointer leaves a key hold to the key").

## A blur ends the gesture

- **Decision** (2026-10-25): a drag on the popup's slider ends where the popup loses focus. The value at the `blur` is saved, and `input` and `change` are ignored until the next press. In twitch-channel-volume this also closes the case of a navigation in the middle of a drag.
- **Decision** (2026-10-25 to 2026-10-28): the `change` that is ignored puts the thumb back to the value saved at the `blur`, in every extension. The next press is a `pointerdown`, or a `keydown` that is not a repeat.
- **Decision** (2026-10-30): the sliders of the settings pages take the same form: a `blur` while the thumb is held ends the gesture with one write, `input` after it is ignored, and the `change` puts the thumb back to what was written.
- **Decision** (2026-10-30): a `blur` of the thumb itself — a Tab pressed in the middle of a drag — ends the drag too, on every slider of the popup and the settings page: one save, with the value at the Tab, and the rest of the drag dropped.
- **Rejected**: leaving the drag to go on; cancelling it at the `blur`; leaving the thumb where the ignored `change` found it; taking a `pointerdown` alone as the next press; ending at a `blur` of the window alone.

## A write that changes nothing is left out

- **Decision** (2026-10-25): a write whose content does not change is not made: in twitch-channel-volume the repeat of an owner event for the same owner, `normalizeChannels` over a state already in order, and a setting saved at the value it has; in every extension the button of the display unit already chosen.
- **Decision** (2026-10-25): twitch-channel-volume's save of a gain at the value it has and its steady save of the measurement are still made: the version, the sequence number and `lastMeasuredAt` they move carry meaning.
- **Rejected**: also leaving out a write that only advances a version.

## A settings change saves Auto's gain only where the target or Auto's default changed

- **Decision** (2026-10-25): in yt-channel-volume and twitch-channel-volume, a settings change saves Auto's gain only where the Target LUFS or Auto's default changed; the gain is applied again as before. A change of the display unit, of the gain overlay, or of twitch-channel-volume's gain during an ad saves nothing.
- **Rejected**: saving on a change of the target alone; twitch-channel-volume no longer saving on a settings change at all.

## Only a tab that is playing writes

- **Decision** (2026-10-25): where one channel is open in two tabs, only a tab whose media is neither paused nor muted makes Auto's own save (yt-channel-volume) and the save of the measurement (twitch-channel-volume). A volume of 0 — the element's, or the extension's gain at 0% — still counts as playing.
- **Decision** (2026-10-25 to 2026-10-28): in yt-channel-volume, a tab that begins to play after its last apply makes Auto's own save at the `play` event, not at the next apply.
- **Decision** (2026-10-30): in twitch-channel-volume, the save of Auto's gain that a settings change starts is likewise sent by a playing tab alone.
- **Rejected**: leaving the overwrite as the way it works; counting a tab at volume 0 as not playing.

## Nothing is saved for a new URL from a message until its first apply is done

- **Decision** (2026-10-25): in yt-channel-volume, until the first apply for a new URL has finished, a message that arrives saves nothing, neither the live save nor Auto's. An answer of "not yet" whose `isLiveContent` is false is read as not known.
- **Decision** (2026-10-25 to 2026-10-28): only the saves a message starts are stopped. A save started by a settings change, by the popup opening or by `play` is not.
- **Rejected**: stopping every save before the first apply, whatever started it. The narrower form was kept when the question came back on 2026-10-29, and again on 2026-10-30 when a review of [yt-channel-volume #82](https://github.com/semnil/yt-channel-volume/pull/82) raised a `play` before the first apply.
- **History**: whether a message carrying a live level can arrive before the first apply was not found out; the repair is the same either way.

## A popup action is refused until the channel of the URL's video is known

- **Decision** (2026-10-25): in yt-channel-volume, until the channel is settled for the video the new URL names, an action from the popup is refused with `state moved`, and the popup reads the state again as it does after any refusal.
- **History**: the guard was kept (2026-10-25 to 2026-10-28) although no case that needs it was found on the site.

## The fetch hook takes only the player response of the URL's video

- **Decision** (2026-10-25 to 2026-10-28): yt-channel-volume's fetch hook takes a `/youtubei/v1/player` response only where it holds the `videoDetails` of the URL's video, and drops any other. The code assumes a live page also receives player responses of other kinds, which had set the type back to a video.

## The DOM's channel is not used after a navigation until the bridge names the video's channel

- **Decision** (2026-10-25 to 2026-10-28): in yt-channel-volume, after a navigation the channel the DOM shows is not used until the bridge has named the channel of that video. The code assumes the DOM can go on showing the channel of the page before.
- **Rejected**: no guard; finding out first, in a signed-in browser, whether the DOM does so.

## A channel's live URL takes the video of the canonical link

- **Decision** (2026-10-28): yt-channel-volume reads the video of a channel's live URL from the page's canonical link, with no guard that waits for the player's response to name the same video ([yt-channel-volume #72](https://github.com/semnil/yt-channel-volume/pull/72)). The code assumes that entering such a URL loads the page anew, so the link is the new page's.
- **Rejected**: holding the video as not known until the canonical link's id matches the `videoId` of the player's response.

## An owner response with no video id is not taken

- **Decision** (2026-10-25 to 2026-10-28): twitch-channel-volume's bridge no longer takes an owner response that names no video as the owner of the VOD on screen.
- **Rejected**: keeping the branch that did.

## A player swapped in during a preview is connected at once

- **Decision** (2026-10-30): in yt-channel-volume, a `<video>` the player swaps in while a preview is playing is connected to the audio path then, not at the next preview message ([yt-channel-volume #86](https://github.com/semnil/yt-channel-volume/pull/86)). twitch-channel-volume connects each new element to the bridge's one `GainNode`, and has no such gap.

## A change notice during a press leaves the thumb alone

- **Decision** (2026-10-30): on a settings page, while a slider's thumb is held, the change notice of an earlier save takes in the target value alone and touches neither the thumb nor its label. The notice had been putting the thumb back to the saved value and losing the value of the press ([yt-channel-volume #86](https://github.com/semnil/yt-channel-volume/pull/86), [twitch-channel-volume #99](https://github.com/semnil/twitch-channel-volume/pull/99)).
- **Decision** (2026-10-31): where the pointer is let go on the value it was pressed at — so that no `change` comes — the page draws the target value; a press that a `blur` ended draws it too.
- **History**: the second was first put off to a pull request of its own, and was brought into the open ones when it turned out that they would have carried the fault into extensions whose `main` did not have it.

## What the documents say about sync follows Chrome's documentation

- **Decision** (2026-10-28): that settings reach the user's other computers is stated on the conditions Chrome's documentation of `chrome.storage` gives — sync turned on, and a Chrome signed in to the same account — with a link to that page, and is not established by a run on two machines.
- **Decision** (2026-10-29): the same wording goes into what is written for developers (`CLAUDE.md`, comments in the code) and for users (the README and the privacy policy, in both languages).
- **Rejected**: taking the statement out; correcting the developers' documents alone.

## What stands on a specification or a scripted run

- **Decision** (2026-10-28 to 2026-10-30): these were left as they stood, and are recorded so that they are not taken for more.
  - The names Chrome gives the value keys in `keydown` and `keyup` (`ArrowLeft` and the rest, `Tab`) are taken from the W3C UI Events key values, not from a real keyboard.
  - Of the ways a write to storage fails, only the write-rate limit of `storage.sync` was brought about; the quota of `storage.local` was not.
  - `settingsLoadFailed` — a save refused and the read after it failing too — was brought about in the tests alone, not in a browser.
  - The order of events where Tab is pressed in the middle of a drag comes from scripted input, not from a real mouse and keyboard.
  - A key held on a settings slider while the user switches to another application was tried from the keyboard alone, not by a click on another window.

## A pull request is swept on the lines it changes

- **Decision** (2026-10-30): a pull request runs the mutation sweep over the lines it changed. A sweep of the whole of a source is run apart from any pull request, from time to time.
- **Reason**: in the full sweeps run for these fixes, every new hole came out of the first; the later ones cost hours and found none.
- **Decision** (2026-10-29): the mutants that lived through the full sweeps run for these fixes were dealt with in the same pull requests, those `main` already had among them. Where a test can kill one, the test went into the commit that brought the code. Where the mutant changes nothing the code's users can tell — a return value nobody reads, an `await` at the end of a handler — the construct was taken out of the code rather than recorded. What was left is recorded in `equivalents.md` with its reason.
- **Rejected**: a full sweep for every pull request; no sweep; a commit of tests alone at the tip of the branch; leaving for later the survivors that were already there.

## Coverage is reported to Codecov

- **Decision** (2026-10-31): the tests run under `NODE_V8_COVERAGE`, `tools/coverage/v8-to-lcov.mjs` turns what V8 leaves into an lcov report of the JS files the package ships, and `codecov/codecov-action` uploads it. A public repository uploads without a token.
- **Decision** (2026-10-31): Codecov's checks keep their defaults: the project check fails where coverage falls below the base, the patch check where the change's coverage is below the base's overall figure.
- **Decision** (2026-10-31): an upload that fails fails the test job.
- **Rejected**: gathering Node's own coverage figures in CI; a patch check at 100%; checks that only inform; letting a failed upload pass.
- **History**: a failed upload now fails the job on a pull request and leaves a push to `main` green ([shared-files.md](../shared-files.md#workflows), "The other workflows").
