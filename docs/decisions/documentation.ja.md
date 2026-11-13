# Documentation decisions

[English](documentation.md)

このリポジトリと各拡張機能の文書について閉じた判断。今有効な規則は `AGENTS.md` の「Layout」と「Conventions」にある。

## `equivalents.md` has no Japanese version

- **決定** (2026-10-20): `tools/mutation/equivalents.md` (テストが通してしまう変異を、リポジトリごとに記録した文書) は、ここでもどの拡張機能でも、英語だけで持つ。
- **理由**: `sweep.mjs --verify` は、この記録の項目をコードと照合する。訳は何とも照合されないので、訳したもとの記録からずれていく。英語の文書と日本語の文書を対で持つのは、文章の文書 (README と `docs/` の下の文書)。文書の監査では、この記録が「対になっていない」と挙がりうる。対が無いのはこの決定によるもので、英語を基本にしたときの直し忘れではない。

## The shared parts are documented here, and an extension documents what it gives them

- **決定** (2026-11-01): 共通コードと共通の道具が何をするかは、`docs/shared-files.md` と `docs/shared-files.ja.md` に 1 回だけ書く。部分ごとに分け、部分ごとに固定の `<a id>` を付ける。各拡張機能の `CLAUDE.md` と `docs/gain-change-and-save.md` の対は、その拡張機能が共通部分に何を渡し、どう使うかを書き、ほかはここへリンクする。`test/docs.test.cjs` が、この文書に `core/common.js` のトップレベルの名前が全部あることと、2 つの言語の `<a id>` が同じであることを見張る ([#46](https://github.com/semnil/channel-volume-core/pull/46)、[#47](https://github.com/semnil/channel-volume-core/pull/47)、[yt-channel-volume #130](https://github.com/semnil/yt-channel-volume/pull/130)、[twitch-channel-volume #141](https://github.com/semnil/twitch-channel-volume/pull/141))。
- **経緯**: それまでは、各拡張機能の文書が、共通の動きを自分で説明していた。

## The Japanese counterpart of a decision record keeps the English headings

- **決定** (2026-11-12): 決定の記録の日本語版 (`docs/decisions/<subject>.ja.md`) の見出しは、英語のファイルの見出しと同じ文字列を、同じ順で使う。ここでもどの拡張機能でも同じ。日本語にするのは本文だけ。`README.ja.md` と `docs/shared-files.ja.md` は決定の記録ではなく、この決定の対象にしない。この 2 つの見出しは日本語。
- **理由**: 節の名前が、2 つの言語で 1 つの文字列になる。そのため、節を指す書き方は、書く側のファイルの言語でも、指す先のファイルの言語でも変わらない。
- **経緯**: それまでは、日本語の記録の見出しは訳したもので、ここの 8 つの記録に 74 個あった。日本語の記録がほかの記録の節を指すときも、訳した見出しで指していた。
