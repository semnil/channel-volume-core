# channel-volume-core

[![codecov](https://codecov.io/gh/semnil/channel-volume-core/graph/badge.svg)](https://codecov.io/gh/semnil/channel-volume-core)

[English](README.md)

channel-volume の拡張機能 ([yt-channel-volume](https://github.com/semnil/yt-channel-volume)、[twitch-channel-volume](https://github.com/semnil/twitch-channel-volume) とその兄弟) が共通に使うファイルです。各拡張機能はその写しを持ち、写しがこのリポジトリの記録したコミットと違うと、その拡張機能の CI が失敗します。

## 共通にしているもの

`shared/` に、拡張機能の中と同じパスでファイルを置いています。`groups.json` がそれを組に分け、各拡張機能は `core.json` に書いた組を受け取ります。

| 組 | ファイル |
|---|---|
| `base` | `core/common.js` (各拡張機能が自分のスクリプトより先に読み込むもの。設定の保存キー、設定の読み取り (sync を先に、sync に無ければ local) と local に残った設定を sync へ移す処理、1 つずつ順に走らせるキュー、Target LUFS の既定値と範囲、ゲインの範囲、拡張機能の実行環境に届くかの判定、ゲインの換算と表示 (Auto の表示を含む)、ある大きさを Target LUFS に合わせるゲイン、スライダーを押し続けにするキー、言語ファイルの引き当て、HTML のエスケープ)、`pack.py`、`gen_icons.py`、変異掃引 (`tools/mutation/`)、カバレッジの変換 (`tools/coverage/`)、`tools/check-shared.sh`、`.github/workflows/ci.yaml`、毎日の同期 (このリポジトリの `sync-core.sh` を走らせる `.github/workflows/sync-core.yaml`)、共有ファイルをどこでも LF の改行で取り出させる `.gitattributes` |
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
2. 各拡張機能の Sync Core workflow (`.github/workflows/sync-core.yaml`) が、毎日 3:00 (日本時間) と、拡張機能の Actions タブから手で走らせたときに走ります。workflow はこのリポジトリを clone し、どのブランチで走らせたときも、拡張機能の既定ブランチでこのリポジトリの `sync-core.sh` を走らせます。走行は 1 本ずつで、走行中に始めた走行はその終わりを待ちます。このリポジトリの `main` が、拡張機能の `core.json` が記録したコミットより進んでいれば、`main` からファイルを写してそのコミットを記録する PR を `sync/channel-volume-core` から出します。すでに開いている PR があれば、それを更新します。auto-merge を許す拡張機能では、必須のチェックが通ると PR がマージされます。それ以外では手でマージするまで待ちます。最後のコミットをほかの人が作った・コミットしたブランチ、走行中に動いたブランチ、読めなかったブランチはそのままにし、走行を失敗にします。`core.json` がすでに `main` を記録しているとき (拡張機能が自分の PR で取り込んだとき) は、`sync/channel-volume-core` から開いたままの PR のブランチを消してから、PR をコメント付きで閉じます。ただし、その PR の最後のコミットをほかの人が作った・コミットしたときは、開いたままにします。消す前にブランチが動いたとき・ブランチを消せなかったときは、PR を開いたままにして走行を失敗にします。fork から出た PR は、ブランチの名前が同じでも、更新も閉じることもしません。
3. 手で写すこともできます。取り込むコミットにしたこのリポジトリの clone から、次を走らせます。

   ```sh
   node <このリポジトリ>/sync.mjs <このリポジトリ> <拡張機能>
   ```

   `sync.mjs` は、作業ツリーではなく、このリポジトリの `HEAD` のコミットからファイルを読みます。読んだファイルを拡張機能に書き、そのコミットを拡張機能の `core.json` に記録します。

### 同期の準備

PR とその push は GitHub App のトークンで行います。拡張機能のチェックがそれに対して走るようにするためです (workflow 自身の `GITHUB_TOKEN` で作った PR では workflow が起動しません)。App には次のリポジトリ権限を与え、拡張機能に入れます。

- Contents: 読み書き
- Pull requests: 読み書き
- Workflows: 読み書き (共有ファイルに workflow が含まれるため)

各拡張機能で、App の client ID を Actions の変数 `SYNC_APP_CLIENT_ID` に、App の秘密鍵の 1 つを Actions の secret `SYNC_APP_PRIVATE_KEY` に置きます。変数が無いと、workflow のジョブは飛ばされます。

拡張機能の CI は `tools/check-shared.sh` を走らせます。これは記録したコミットをこのリポジトリから取り寄せ、それに対して `sync.mjs --check` を走らせます。

Dependabot はこのリポジトリで走り、このリポジトリの workflow と `shared/.github/workflows` の workflow を見ます。拡張機能では Dependabot を走らせません。

## テスト

```sh
node --test test/*.test.cjs test/*.test.mjs
```

## ライセンス

[MIT](LICENSE)
