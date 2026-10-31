# channel-volume-core

[日本語](README.ja.md)

The files the channel-volume extensions — [yt-channel-volume](https://github.com/semnil/yt-channel-volume), [twitch-channel-volume](https://github.com/semnil/twitch-channel-volume) and their siblings — share. Each extension carries a copy of them, and its CI fails where a copy differs from the commit of this repository the extension locks.

## What is shared

`shared/` holds the files, at the path each one has in an extension. `groups.json` sorts them into groups, and an extension takes the groups its `core.json` names.

| Group | Files |
|---|---|
| `base` | `pack.py`, `gen_icons.py`, the mutation sweep (`tools/mutation/`), the coverage converter (`tools/coverage/`), `tools/check-shared.sh`, `.github/workflows/ci.yaml` and `.gitattributes`, which checks every shared file out with LF line endings |
| `release` | `.github/workflows/release.yaml`, `.github/workflows/tag-release.yaml` and the scripts they run |
| `auto-merge` | The Dependabot auto-merge workflow and its test |
| `public` | `CODEOWNERS`, `FUNDING.yml` and the issue templates |

## core.json

Each extension has a `core.json` at its root. Nothing the extension loads refers to it, so the package never carries it.

```json
{
  "core": {
    "groups": ["base", "release", "auto-merge", "public"],
    "commit": "<the commit of this repository the copies come from>"
  },
  "package": "yt-channel-volume",
  "icon": { "background": [26, 26, 46], "accent": [255, 0, 0], "letter": "Y" }
}
```

- `core.groups`: the groups the extension takes
- `core.commit`: written by `sync.mjs`
- `package`: the name `pack.py` gives the zip, before the version
- `icon`: the colours and the mark `gen_icons.py` draws

## Changing a shared file

1. Change the file under `shared/` here, with its tests under `test/`, and merge it.
2. In each extension, copy the files from the merged commit:

   ```sh
   node <this repository>/sync.mjs <this repository> <extension>
   ```

   `sync.mjs` reads the files from this repository's `HEAD` commit, not from its working tree, writes them into the extension and records that commit in the extension's `core.json`.
3. Open a pull request in each extension with the copies and `core.json`.

An extension's CI runs `tools/check-shared.sh`, which fetches the locked commit from this repository and runs `sync.mjs --check` against it.

Dependabot runs here, over this repository's workflows and the ones under `shared/.github/workflows`; the extensions run none of their own.

## Tests

```sh
node --test test/*.test.cjs test/*.test.mjs
```

## License

[MIT](LICENSE)
