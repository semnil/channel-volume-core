# channel-volume-core

[![codecov](https://codecov.io/gh/semnil/channel-volume-core/graph/badge.svg)](https://codecov.io/gh/semnil/channel-volume-core)

[English](README.md)

channel-volume の拡張機能 ([yt-channel-volume](https://github.com/semnil/yt-channel-volume)、[twitch-channel-volume](https://github.com/semnil/twitch-channel-volume) とその兄弟) が共通に使うファイルです。各拡張機能はその写しを持ち、写しがこのリポジトリの記録したコミットと違うと、その拡張機能の CI が失敗します。

## 共通にしているもの

`shared/` に、拡張機能の中と同じパスでファイルを置いています。`groups.json` がそれを組に分け、各拡張機能は `core.json` に書いた組を受け取ります。

| 組 | ファイル |
|---|---|
| `base` | `pack.py`、`gen_icons.py`、変異掃引 (`tools/mutation/`)、カバレッジの変換 (`tools/coverage/`)、`tools/check-shared.sh`、`.github/workflows/ci.yaml`、共有ファイルをどこでも LF の改行で取り出させる `.gitattributes` |
| `release` | `.github/workflows/release.yaml`、`.github/workflows/tag-release.yaml` と、それらが走らせるスクリプト |
| `auto-merge` | Dependabot の自動マージの workflow とそのテスト |
| `public` | `CODEOWNERS`、`FUNDING.yml`、issue のテンプレート |

## core.json

各拡張機能は、ルートに `core.json` を持ちます。拡張機能が読み込むものからは参照されないので、パッケージには入りません。

```json
{
  "core": {
    "groups": ["base", "release", "auto-merge", "public"],
    "commit": "<写しの元になった、このリポジトリのコミット>"
  },
  "package": "yt-channel-volume",
  "icon": { "background": [26, 26, 46], "accent": [255, 0, 0], "letter": "Y" }
}
```

- `core.groups`: その拡張機能が受け取る組
- `core.commit`: `sync.mjs` が書きます
- `package`: `pack.py` が zip に付ける名前 (版の前の部分)
- `icon`: `gen_icons.py` が描く色と文字

## 共通ファイルを変えるとき

1. このリポジトリの `shared/` のファイルと `test/` のテストを変えて、マージします。
2. 各拡張機能で、マージしたコミットからファイルを写します。

   ```sh
   node <このリポジトリ>/sync.mjs <このリポジトリ> <拡張機能>
   ```

   `sync.mjs` は、作業ツリーではなく、このリポジトリの `HEAD` のコミットからファイルを読みます。読んだファイルを拡張機能に書き、そのコミットを拡張機能の `core.json` に記録します。
3. 各拡張機能で、写したファイルと `core.json` の PR を出します。

拡張機能の CI は `tools/check-shared.sh` を走らせます。これは記録したコミットをこのリポジトリから取り寄せ、それに対して `sync.mjs --check` を走らせます。

Dependabot はこのリポジトリで走り、このリポジトリの workflow と `shared/.github/workflows` の workflow を見ます。拡張機能では Dependabot を走らせません。

## テスト

```sh
node --test test/*.test.cjs test/*.test.mjs
```

## ライセンス

[MIT](LICENSE)
