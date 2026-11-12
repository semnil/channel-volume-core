# Interface decisions

[日本語](ui.ja.md)

Closed decisions about the popup and the settings page that hold for every extension. The parts of those pages the extensions share are in [shared-files.md](../shared-files.md#popup) ("The popup", "The settings page", "Slider gestures").

## The extensions share one look

- **Decision**: the extensions are one series, and their popup and settings page are kept alike in these:
  - Colours: background `#1a1a2e`, the deeper `#0f0f23`, panels `#16213e`, and the accents teal `#4ecdc4`, yellow `#f9ca24` and pink `#ff6b9d`.
  - The popup: a header (the title and the gear that opens the settings), the information section (the channel's name, the type badge, and one row of three cards: Integrated, Suggested, Current), the apply section, and the manual section (the slider and six presets: 0, 50, 100, 200, 400 and MAX).
  - The settings page: a heading over section cards (`#1a1a2e`, 10px radius) for the Target LUFS, the display unit's toggle group and the table of saved channels.
  - The names of the messages both carry, such as `targetLufs`, `displayUnit`, `savedChannels`, `applyToChannel`, `clearAll` and `manualVolume`.
- **Decision**: a change to one extension's interface is compared with the same screen of the others, for naming, colours and layout. What only one platform has — an ad break, a live or VOD kind — keeps the row of cards as it is when it is shown in the popup.
- **Reason**: the extensions do one thing, a volume per channel, on different sites, and are meant to look and read as one series.

## A value only one platform has does not get a popup card

- **Decision**: a card, a row or a figure the other extensions do not have is not added to the popup. Where one seems needed, the question is asked before it is added. A supplementary value stays in the extension's state; the settings page or a development log is where it can be read.
- **History**: while twitch-channel-volume's popup was being aligned with the others, the Momentary and Short-term loudness it measures were shown as two more cards, and the cards were taken out again ([twitch-channel-volume #13](https://github.com/semnil/twitch-channel-volume/pull/13) names the commit). Suggested and Current stayed, since the others have them.
- **Reason**: the series is wanted with one interface, and the popup is not to grow platform by platform.

## Polling may write a control the viewer cannot operate

- **Decision**: the rule is in `CLAUDE.md`, "Conventions": what decides is whether the viewer can operate the control at that moment, and one element is written by one path.
- **Reason**: the harm the general rule against polling a control guards against is a value pulled back in the middle of a drag. The popup sets `disabled` on the manual slider and the preset buttons while Auto holds the gain (`manualDisabled` in each extension's `popup.js`), and a disabled control takes no drag for a poll to pull back. For that time, bringing them to the gain in effect on each poll is the right thing: without the poll the gain plays at one value and the slider shows another.
- **Harm recorded**: with the rule written as "an interactive element is never polled", the change that made the popup follow the gain while Auto is on was nearly judged a regression in review. In the same change the Current card was written from two paths, which review found; it is written from one ([twitch-channel-volume #4](https://github.com/semnil/twitch-channel-volume/pull/4)).

## Muted text is `#999`

- **Decision** (2026-08-21): the muted text of the popup and the settings page is `#999`. The declarations it replaced, their contrast ratios, why `#888` was not taken and what is out of scope are in [twitch-channel-volume #4](https://github.com/semnil/twitch-channel-volume/pull/4).
- **Decision** (2026-11-12): the colour is the series', not twitch-channel-volume's alone. yt-channel-volume takes it too, in a pull request of its own that redraws its screenshots.
