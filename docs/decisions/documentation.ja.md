# 文書の決定

[English](documentation.md)

このリポジトリと各拡張機能の文書について閉じた判断。今有効な規則は `CLAUDE.md` の「Layout」と「Conventions」にある。

## `equivalents.md` に日本語版は無い

- **決定** (2026-10-20): `tools/mutation/equivalents.md` (テストが通してしまう変異を、リポジトリごとに記録した文書) は、ここでもどの拡張機能でも、英語だけで持つ。
- **理由**: `sweep.mjs --verify` は、この記録の項目をコードと照合する。訳は何とも照合されないので、訳したもとの記録からずれていく。英語の文書と日本語の文書を対で持つのは、文章の文書 (README と `docs/` の下の文書)。文書の監査では、この記録が「対になっていない」と挙がりうる。対が無いのはこの決定によるもので、英語を基本にしたときの直し忘れではない。

## 共通部分はここに書き、各拡張機能は自分が渡すものを書く

- **決定** (2026-11-01): 共通コードと共通の道具が何をするかは、`docs/shared-files.md` と `docs/shared-files.ja.md` に 1 回だけ書く。部分ごとに分け、部分ごとに固定の `<a id>` を付ける。各拡張機能の `CLAUDE.md` と `docs/gain-change-and-save.md` の対は、その拡張機能が共通部分に何を渡し、どう使うかを書き、ほかはここへリンクする。`test/docs.test.cjs` が、この文書に `core/common.js` のトップレベルの名前が全部あることと、2 つの言語の `<a id>` が同じであることを見張る ([#46](https://github.com/semnil/channel-volume-core/pull/46)、[#47](https://github.com/semnil/channel-volume-core/pull/47)、[yt-channel-volume #130](https://github.com/semnil/yt-channel-volume/pull/130)、[twitch-channel-volume #141](https://github.com/semnil/twitch-channel-volume/pull/141))。
- **経緯**: それまでは、各拡張機能の文書が、共通の動きを自分で説明していた。
