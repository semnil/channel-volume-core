# Error-list decisions

[日本語](page-errors.ja.md)

Closed decisions about what an extension keeps out of Chrome's error list for it, and what it lets through. The rules in force are in each extension's `AGENTS.md` ("A page fetch nothing handles") and in [shared-files.md](../shared-files.md#gain) (`createUnaskedWriteReporter`, under "Gain").

## A page request's failure is kept out of the error list by its stack

- **Decision** (2026-09-13): a request the page makes on a page the extension works on goes through a named function of the bridge (`requestMadeOnWatchPage` in yt-channel-volume, `requestMadeOnContentPage` in twitch-channel-volume). The bridge's `unhandledrejection` listener prevents the default only for a `TypeError` reading `Failed to fetch` whose stack holds that function's `chrome-extension://` frame, and attaches nothing to any promise ([yt-channel-volume #48](https://github.com/semnil/yt-channel-volume/pull/48), [twitch-channel-volume #64](https://github.com/semnil/twitch-channel-volume/pull/64)). The code assumes that the stack of a failed fetch's `TypeError` names the function that called `fetch`, whether the page awaits the promise, chains from it or leaves it alone. A page that sets `Error.stackTraceLimit` to 0 gets stacks with no frame; there the failure is left in the list rather than stopped.
- **Rejected**:
  1. Preventing the default by the error's type and message alone. It also stops the page's own promise rejected with the same `TypeError`, and a request made on a page the extension does not work on.
  2. Attaching a handler to the promise handed back to the page and recording the reason in a `WeakSet`. The promise is then handled, so an abort of that request, or another `TypeError` from it, raises no `unhandledrejection` at all.
  3. Keeping the promise handed back in a `WeakSet` and telling it by the event's `promise`. Only the form with no handler is stopped; where the page chains from the promise or awaits it, the failure stays in the list.
- **Harm recorded**: the first form was carried from one extension to the others and sent back in review, and the second was sent back after it. Both times what had been checked was whether the failure was stopped, and not whether too much was stopped with it. A check of this path raises, in one run, the failures that are to be stopped and the ones that are not. The three forms above are not proposed again.

## Each unasked write keeps a stretch of its own

- **Decision** (2026-09-20): a write no gesture asked for, which the next one of its kind repeats, is logged at info the first time it fails and at error the next, and each kind keeps its own stretch of failures ([yt-channel-volume #51](https://github.com/semnil/yt-channel-volume/pull/51)).
- **Harm recorded**: the stretch was at first one state shared by the kinds of write. In yt-channel-volume one message from the bridge sends the adoption of a handle ahead of Auto's save, and where the channel's row is already there the adoption writes nothing and is answered ok. Shared, that ok ended the stretch on every message, and an Auto save that failed every time never reached error. The tests then in place called `applyPreferredGain()` directly and so never went through that order; the fault passed them and was found in review. Cases that go through a bridge message were added, and they are the ones that fail when the stretch is shared again.
