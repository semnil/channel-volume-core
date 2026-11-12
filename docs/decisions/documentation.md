# Documentation decisions

[日本語](documentation.ja.md)

Closed decisions about the documents of this repository and of the extensions. The rules in force are in `CLAUDE.md`, "Layout" and "Conventions".

## `equivalents.md` has no Japanese version

- **Decision** (2026-10-20): `tools/mutation/equivalents.md`, each repository's record of the mutants its tests let through, is kept in English alone, here and in every extension.
- **Reason**: `sweep.mjs --verify` holds the entries of that record to the code. A translation would be held to nothing and would drift from the record it translates. The pairs of an English document and its Japanese counterpart are for prose: the README and the documents under `docs/`. An audit of the documents can find this record unpaired; it was left so by this decision, not left behind by the move to English.

## The shared parts are documented here, and an extension documents what it gives them

- **Decision** (2026-11-01): what the shared code and the shared tools do is written once, in `docs/shared-files.md` and `docs/shared-files.ja.md`, part by part, each part under a fixed `<a id>`. An extension's `CLAUDE.md` and its `docs/gain-change-and-save.md` pair say what that extension hands those parts and how it uses them, and link here for the rest. `test/docs.test.cjs` holds the document to every top-level name of `core/common.js` and holds the two languages to the same anchors ([#46](https://github.com/semnil/channel-volume-core/pull/46), [#47](https://github.com/semnil/channel-volume-core/pull/47), [yt-channel-volume #130](https://github.com/semnil/yt-channel-volume/pull/130), [twitch-channel-volume #141](https://github.com/semnil/twitch-channel-volume/pull/141)).
- **History**: until then each extension's documents described the shared behaviour themselves.
