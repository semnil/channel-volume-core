# Packaging and release decisions

[日本語](packaging-release.ja.md)

Closed decisions about the package `pack.py` builds and about the release workflows. What those files do is in [shared-files.md](../shared-files.md#package) ("The package and the icons", "Releases").

## The `_locales` contract is the store's locale list

- **Decision**: `pack.py` holds every directory under `_locales/` to the locale list the Chrome Web Store publishes, in the store's spelling, and not to what Chrome's loader accepts ([yt-channel-volume #28](https://github.com/semnil/yt-channel-volume/pull/28), [twitch-channel-volume #46](https://github.com/semnil/twitch-channel-volume/pull/46)). This is not argued again from the loader.
- **Reason**: an extension is localized for a listing, and the listing is the store's. The code assumes the loader takes directory names the store's list does not carry, so what the loader takes says nothing about what the store lists.
- **History**: the list was taken out once on the ground of what the loader accepts, and put back in the next round of review. The loader counts in another direction, which is the next decision.

## The locales are the names that hold a `messages.json`

- **Decision**: a check that walks `_locales/` takes as locales the names that hold a `messages.json`, not every name the directory lists. `pack.py` requires a `messages.json` in each locale directory: the code assumes Chrome refuses to load an extension where a directory it reads as a locale has none.
- **Harm recorded**: a check read `_locales/` name by name and opened `messages.json` under each. In a working tree on macOS it reached `_locales/.DS_Store/messages.json`, failed with `ENOTDIR` and took the whole suite down. CI, on a fresh checkout, stayed green, so the fault was noticed only after it was merged into the default branch ([yt-channel-volume #13](https://github.com/semnil/yt-channel-volume/pull/13), [yt-channel-volume #14](https://github.com/semnil/yt-channel-volume/pull/14)).

## The archive is the same bytes on every host

- **Decision**: `pack.py` writes every entry under one time, one mode and one host, so the same files build the same zip however the modification times and modes of the tree differ. It was held to that across macOS on arm64 and Linux on arm64 and amd64, zlib 1.2.12 and 1.3, and Python 3.9 to 3.14, and by comparing, byte for byte, the artifact a CI runner built with a local build of the same commit. Under the same comparison the packer as it was before splits between macOS and Linux on amd64, so the comparison can tell the two apart.
- **Decision**: no document carries a digest of the zip. The digest moves with every change to a file that ships; what is compared is always a runner's output and a local output of one commit.

## A four-part version is not supported

- **Decision**: a release is `vN.N.N`, or that with `-beta`, `-rc` or `-alpha` ([yt-channel-volume #29](https://github.com/semnil/yt-channel-volume/pull/29), [twitch-channel-volume #47](https://github.com/semnil/twitch-channel-volume/pull/47)). The tag patterns `release.yaml` runs on match no tag of four parts, so a push of one starts no run at all; the refusal in `tools/check-tag.sh` is reached only by a tag of the form `vN.N.N-<another suffix>`.

## Choosing the version

- **Decision**: a release that holds a `feat:` commit is a minor version, and one that holds fixes alone is a patch — except that a fix which changes what the user sees or hears makes it a minor. yt-channel-volume's v1.2.0 held `fix:` commits alone and was made a minor: with the player's stable volume on, which is its default, the Loudness shown and the gain Auto sets changed ([yt-channel-volume #53](https://github.com/semnil/yt-channel-volume/pull/53)).
