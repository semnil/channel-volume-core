# パッケージとリリースの決定

[English](packaging-release.md)

`pack.py` が作るパッケージと、リリースのワークフローについて閉じた判断。これらのファイルが何をするかは、[shared-files.ja.md](../shared-files.ja.md#package) の「パッケージとアイコン」と「リリース」にある。

## `_locales` の契約は、ストアのロケールの一覧

- **決定**: `pack.py` は、`_locales/` の下のディレクトリの名前を、Chrome ウェブストアが公開しているロケールの一覧と、ストアの綴りで照合する。Chrome のローダーが受け付けるかどうかでは照合しない ([yt-channel-volume #28](https://github.com/semnil/yt-channel-volume/pull/28)、[twitch-channel-volume #46](https://github.com/semnil/twitch-channel-volume/pull/46))。この点を、ローダーを根拠にもう一度議論しない。
- **理由**: 拡張機能を各言語に対応させるのは掲載のためで、掲載はストアのもの。コードは、ローダーがストアの一覧に無いディレクトリ名も受け付けることを前提にしている。だから、ローダーが受け付けるかどうかからは、ストアが掲載するかどうかは分からない。
- **経緯**: ローダーが受け付けることを根拠に、一覧を一度外し、次のレビューの回で戻した。ローダーは別の向きで効く。それが次の決定。

## ロケールは、`messages.json` を持つ名前

- **決定**: `_locales/` をたどる検査は、ディレクトリに並ぶ名前の全部ではなく、`messages.json` を持つ名前をロケールとして扱う。`pack.py` は、ロケールのディレクトリごとに `messages.json` を求める。コードは、Chrome がロケールとして読むディレクトリに `messages.json` が無い拡張機能を、Chrome が読み込まないことを前提にしている。
- **実害の記録**: ある検査が `_locales/` の名前を 1 つずつ読み、それぞれの下の `messages.json` を開いていた。macOS の作業ツリーでは `_locales/.DS_Store/messages.json` を開こうとして `ENOTDIR` で失敗し、テスト全体が落ちた。新しくチェックアウトする CI は緑のままだったので、既定ブランチへマージした後になって気付いた ([yt-channel-volume #13](https://github.com/semnil/yt-channel-volume/pull/13)、[yt-channel-volume #14](https://github.com/semnil/yt-channel-volume/pull/14))。

## アーカイブは、どのホストでも同じバイト列になる

- **決定**: `pack.py` は、どの項目も 1 つの時刻・1 つのモード・1 つのホストで書く。そのため、ツリーの更新時刻やモードがどう違っても、同じファイルからは同じ zip ができる。これは、arm64 の macOS、arm64 と amd64 の Linux、zlib 1.2.12 と 1.3、Python 3.9 から 3.14 の組み合わせと、CI のランナーが作った成果物と手元で作ったものを同じコミットでバイト単位に比べることで確かめた。同じ比べ方で、直す前の `pack.py` は macOS と amd64 の Linux で結果が分かれる。だから、この比べ方は 2 つを見分けられる。
- **決定**: zip のダイジェストの値は、どの文書にも書かない。ダイジェストは、パッケージに入るファイルが変わるたびに動く。比べるのは、いつも、同じコミットについてのランナーの出力と手元の出力。

## 4 つの数字の版には対応しない

- **決定**: リリースは `vN.N.N` か、それに `-beta`・`-rc`・`-alpha` を付けたもの ([yt-channel-volume #29](https://github.com/semnil/yt-channel-volume/pull/29)、[twitch-channel-volume #47](https://github.com/semnil/twitch-channel-volume/pull/47))。`release.yaml` が動くタグのパターンは、4 つの数字のタグに一致しない。そのため、そういうタグを push しても、ワークフローは 1 回も動かない。`tools/check-tag.sh` が断るところまで届くのは、`vN.N.N-<ほかの接尾辞>` の形のタグだけ。

## 版の選び方

- **決定**: `feat:` のコミットを含むリリースはマイナーの版、修正だけのリリースはパッチの版にする。ただし、利用者に見える・聞こえるものを変える修正は、マイナーの版にする。yt-channel-volume の v1.2.0 は `fix:` のコミットだけだったが、マイナーにした。プレイヤーの一定音量がオン (プレイヤーの既定) のとき、表示する Loudness と、Auto がかけるゲインが変わったため ([yt-channel-volume #53](https://github.com/semnil/yt-channel-volume/pull/53))。
