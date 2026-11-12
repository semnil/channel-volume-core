# Measurement decisions

[日本語](measurement.ja.md)

Closed decisions about the shared meter. What the meter does is in [shared-files.md](../shared-files.md#loudness) ("`core/loudness.js`"). The two below were made in twitch-channel-volume, where the meter was written before it came here; how that extension shows a seeded value is recorded there.

## The seed's floor applies whatever window count the stored value carries

- **Decision** (2026-08-22): a seed is laid down as `max(MIN_SEED_WINDOWS, stored count)` windows. The floor of 300 windows (30 seconds) applies to a stored value that carries a smaller count as well as to one that carries none ([twitch-channel-volume #16](https://github.com/semnil/twitch-channel-volume/pull/16)).
- **Rejected**: the floor only for a stored value with no window count. The two forms differ only where the stored count is under 300. Run against both, with the target at -18 LUFS:
  - A stored value from 5 seconds of watching (47 windows), and a stream that opens 12 dB lower for its first 10 seconds: the form taken keeps the gain near 100% throughout; the rejected one swings to 144% at 10 seconds.
  - A stored value that is broken (one window: 400 ms at -8 LUFS): the other way round. The form taken holds 32% for 60 seconds where about 190% is right; the rejected one is back within 10 seconds.
- **Accepted cost**: a broken stored value stays for up to a minute. Seen as a symptom, it reads as Auto holding a gain that is plainly wrong, and the fix that suggests itself is the rejected form.
- **Reopen when**: the floor and the cap are not moved by a fix for that symptom. A proposal to move either is put as a question before the code changes.

## The seed's cap is three minutes

- **Decision** (2026-08-22): the cap is `MAX_SEED_WINDOWS`, 1800 windows. The decision and its reason are in [twitch-channel-volume #16](https://github.com/semnil/twitch-channel-volume/pull/16), "What changed".
