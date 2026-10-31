# channel-volume-core

[日本語](README.ja.md)

The files the channel-volume extensions — [yt-channel-volume](https://github.com/semnil/yt-channel-volume), [twitch-channel-volume](https://github.com/semnil/twitch-channel-volume) and their siblings — share. Each extension carries a copy of them, and its CI fails where a copy differs from the commit of this repository the extension locks.

## What is shared

`shared/` holds the files, at the path each one has in an extension. `groups.json` sorts them into groups, and an extension takes the groups its `core.json` names.

| Group | Files |
|---|---|
| `base` | `pack.py`, `gen_icons.py`, the mutation sweep (`tools/mutation/`), the coverage converter (`tools/coverage/`), `tools/check-shared.sh`, `.github/workflows/ci.yaml`, the daily sync (`.github/workflows/sync-core.yaml` and `tools/sync-core.sh`) and `.gitattributes`, which checks every shared file out with LF line endings |
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
2. Each extension's Sync Core workflow (`.github/workflows/sync-core.yaml`) runs once a day at 03:00 JST, and when run by hand from the extension's Actions tab. Where this repository's `main` has moved past the commit the extension's `core.json` locks, it opens a pull request from `sync/channel-volume-core` that copies the files from `main` and locks that commit, or updates the one already open. Where the extension allows auto-merge, the pull request merges once its required checks pass; elsewhere it waits to be merged by hand. A branch someone else has added a commit to is left as it is, and the run fails naming them.
3. The copy can also be made by hand, from a clone of this repository at the commit to take:

   ```sh
   node <this repository>/sync.mjs <this repository> <extension>
   ```

   `sync.mjs` reads the files from this repository's `HEAD` commit, not from its working tree, writes them into the extension and records that commit in the extension's `core.json`.

### Setting up the sync

The pull request and its push are made with a GitHub App's token, so that the extension's checks run on them; a pull request made with a workflow's own `GITHUB_TOKEN` starts no workflows. The App needs these repository permissions, and is installed on the extensions:

- Contents: read and write
- Pull requests: read and write
- Workflows: read and write (the shared files include workflows)

In each extension, the App's client ID is the Actions variable `SYNC_APP_CLIENT_ID`, and one of its private keys the Actions secret `SYNC_APP_PRIVATE_KEY`. Where the variable is not set, the workflow's job is skipped.

An extension's CI runs `tools/check-shared.sh`, which fetches the locked commit from this repository and runs `sync.mjs --check` against it.

Dependabot runs here, over this repository's workflows and the ones under `shared/.github/workflows`; the extensions run none of their own.

## Tests

```sh
node --test test/*.test.cjs test/*.test.mjs
```

## License

[MIT](LICENSE)
