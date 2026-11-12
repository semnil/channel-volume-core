# Error-list decisions

[English](page-errors.md)

Chrome が拡張機能ごとに持つエラー一覧に、拡張機能が何を載せず、何を載せたままにするかについて閉じた判断。今有効な規則は、各拡張機能の `CLAUDE.md` の「A page fetch nothing handles」と、[shared-files.ja.md](../shared-files.ja.md#gain) の「ゲイン」の `createUnaskedWriteReporter` にある。

## A page request's failure is kept out of the error list by its stack

- **決定** (2026-09-13): 拡張機能が扱うページでページが出すリクエストは、ブリッジの名前付きの関数 (yt-channel-volume は `requestMadeOnWatchPage`、twitch-channel-volume は `requestMadeOnContentPage`) を通す。ブリッジの `unhandledrejection` の受け手は、`Failed to fetch` という `TypeError` のうち、stack にその関数の `chrome-extension://` のフレームがあるものだけ、既定の動作を止める。どの promise にもハンドラを付けない ([yt-channel-volume #48](https://github.com/semnil/yt-channel-volume/pull/48)、[twitch-channel-volume #64](https://github.com/semnil/twitch-channel-volume/pull/64))。コードは、失敗した fetch の `TypeError` の stack が、`fetch` を呼んだ関数の名前を持つことを前提にしている。ページがその promise を await しても、そこから then でつないでも、何もしなくても同じ。ページが `Error.stackTraceLimit` を 0 にしていると、stack にフレームが無い。そのときは止めずに、一覧に載るままにする。
- **却下した案**:
  1. エラーの型と文言だけで既定の動作を止める。ページ自身の promise が同じ `TypeError` で reject されたときと、拡張機能が扱わないページで出たリクエストまで止めてしまう。
  2. ページへ返す promise にハンドラを付け、reason を `WeakSet` に記録する。その promise は処理済みになるので、そのリクエストの中断や、別の `TypeError` でも、`unhandledrejection` そのものが起きなくなる。
  3. ページへ返した promise を `WeakSet` に持ち、イベントの `promise` で見分ける。止まるのはハンドラの無い形だけで、ページがその promise から then でつないだときと await したときは、一覧に載ったままになる。
- **実害の記録**: 1 つ目の形を 1 つの拡張機能からほかへ広げて、レビューで差し戻された。2 つ目の形も、その後に差し戻された。どちらのときも、確かめていたのは「失敗が止まるか」だけで、「止めすぎていないか」を確かめていなかった。この経路を確かめるときは、止める失敗と止めない失敗を、1 回の実行の中で両方起こす。上の 3 つの形は、もう一度提案しない。

## Each unasked write keeps a stretch of its own

- **決定** (2026-09-20): 操作に頼まれたのではなく、同じ種類の次の書き込みがやり直す書き込みは、最初の失敗を info、次の失敗を error で記録する。失敗の一続きは、書き込みの種類ごとに数える ([yt-channel-volume #51](https://github.com/semnil/yt-channel-volume/pull/51))。
- **実害の記録**: 初めは、失敗の一続きを、書き込みの種類の間で 1 つの状態として共有していた。yt-channel-volume では、ブリッジからの 1 つのメッセージが、ハンドルの採用を Auto の保存より先に送る。チャンネルの行が既にあるとき、採用は何も書かずに ok と答える。状態を共有していると、その ok がメッセージのたびに失敗の一続きを終わらせ、Auto の保存が毎回失敗しても error に届かなかった。当時のテストは `applyPreferredGain()` を直接呼んでいたので、この順を通らず、欠陥はテストを通ってレビューで見つかった。ブリッジのメッセージを通すテストを足した。状態を共有する形に戻すと落ちるのは、そのテストである。
