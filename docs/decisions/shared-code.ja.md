# Shared-code decisions

[English](shared-code.md)

拡張機能が同じように持っていたコードをこのリポジトリへまとめたときに閉じた判断。日付の無いものは 2026-10-31 と 2026-11-01 に決まった。何を共有するか、それが拡張機能へどう届くか、共有する各部分が、拡張機能の持っていた形のうちどれを取ったか、を持つ。共通ファイルが今何をするかは [shared-files.ja.md](../shared-files.ja.md) と [README](../../README.ja.md) にある。

## What is shared, and what stays in each extension

- **決定**: 道具 (`pack.py`、`tools/mutation/`、CI とリリースのワークフロー、`.github/tests/`、`gen_icons.py`) を共有する。あわせて、popup と設定ページの処理、設定の保存と同期、ゲインの換算も共有する。拡張機能の `content.js` と `page-bridge.js` がサイトとやりとりする部分は、各拡張機能に残す。
- **却下した案**: 道具だけを共有する。拡張機能を 1 つのリポジトリにまとめる。
- **経緯**: 3 つの段で進めた。道具、次に動きを変えずに共有できるコード、最後に形が違っていたコード。どの段も、ここのプルリクエスト 1 本と、それを受け取る各拡張機能のプルリクエスト 1 本ずつで入れた。

## The shared files live in a public repository of their own

- **決定**: 共通ファイルは、公開のこのリポジトリに置く。共有する部分の変更は、ここでプルリクエストと CI を通してから、拡張機能へ写す。
- **却下した案**: yt-channel-volume を、ほかが写すもとにする。

## The extensions pull the shared files

- **決定** (2026-10-31): 共有するものは、各拡張機能が取りに行く。共有の `sync-core.yaml` が、拡張機能の側で 1 日 1 回と手動で動く。このリポジトリの `main` が、拡張機能の記録しているコミットより先へ進んでいれば、`sync/channel-volume-core` からプルリクエストを開く。ワークフローは、このリポジトリの `sync-core.sh` を、このリポジトリの clone から動かす (このスクリプトは共通ファイルに入っていない)。動くのは 1 回に 1 つ。拡張機能が auto-merge を許していれば、プルリクエストは必須のチェックが通った後にマージされる ([#5](https://github.com/semnil/channel-volume-core/pull/5)、[#6](https://github.com/semnil/channel-volume-core/pull/6))。
- **決定** (2026-10-31): push とプルリクエストは、GitHub App のトークンで行う (変数 `SYNC_APP_CLIENT_ID` と secret `SYNC_APP_PRIVATE_KEY`。変数が無ければジョブを飛ばす)。ワークフロー自身の `GITHUB_TOKEN` は使わない。コードは、`GITHUB_TOKEN` で作ったプルリクエストがワークフローを起動しないことを前提にしている。それでは、写した内容に拡張機能の CI がかからない。

## A sync pull request with nothing left to take loses its branch first

- **決定** (2026-10-31): 拡張機能が既に `main` を記録していて、`sync/channel-volume-core` からのプルリクエストがまだ開いているとき、同期は、読んだコミットに lease を掛けてブランチを消し、その後で、プルリクエストを番号で、コメントを付けて閉じる ([#10](https://github.com/semnil/channel-volume-core/pull/10))。
- **却下した案**: ブランチを残してプルリクエストだけを閉じる ([#12](https://github.com/semnil/channel-volume-core/pull/12)。マージせずに閉じた)。ブランチを読んでからプルリクエストを閉じるまでにすき間がある。そこへ入った push のプルリクエストを閉じてしまうことになり、プルリクエストを閉じる操作には、先端のコミットを条件にする指定が無い。閉じた後に読み直して、ブランチが動いていたら開き直す形も、一緒に却下した。
- **理由**: リポジトリは、マージしたときにヘッドのブランチを消す設定だが、消えるのはマージされたプルリクエストのブランチだけ。マージせずに閉じたプルリクエストのブランチは、同期が消さなければ残る。

## Dependabot runs here alone

- **決定** (2026-10-31): 共有のワークフローが使う Action の版は、ここで上げる。このリポジトリの `dependabot.yml` が、自分のワークフローと `shared/.github/workflows` を見る。拡張機能は `dependabot.yml` を持たず、上がった版は、共有するほかの変更と同じ道で拡張機能へ届く。auto-merge のワークフローは、必須のチェック `auto-merge` を出すので、それを受け取る拡張機能に残す。
- **却下した案**: ワークフローを共有せず、Dependabot と自動マージを各拡張機能に残す。

## The shared code is tested and covered here alone

- **決定**: 共通コードのテストはここに置き、`node:test` で書く。テストが通してしまう変異の記録も、拡張機能の記録ではなく、ここに置く。
- **決定** (2026-11-01): `core/common.js` の変異は、理由つきで記録したものを除いて、ここのテストだけで全部落とす。そうなった後で、共有の `ci.yaml` は拡張機能のカバレッジの報告から `core/` を外し、共通コードの行を通すためだけに拡張機能が持っていたテストは、拡張機能から消した ([#42](https://github.com/semnil/channel-volume-core/pull/42)、[#43](https://github.com/semnil/channel-volume-core/pull/43))。
- **却下した案**: ここのテストだけで足りるようになる前に、拡張機能のカバレッジから `core/` を外す。共通コードを、ここでも各拡張機能でも数える。
- **経緯**: 拡張機能のカバレッジが `core/` を数えていた間 (2026-10-31) は、2 つの扱いを決めていた。拡張機能が呼ばない共通の関数は、その拡張機能の Codecov のチェックが失敗したままマージした (テストに呼び出しを足すことも、`core/` を外すこともしなかった)。拡張機能が呼ぶ関数の中の、その拡張機能の書き込みからは届かない分岐は、同じ扱いにせず、拡張機能のテストでその分岐を動かしてからマージした。どちらも、`core/` が拡張機能のカバレッジから外れて、当たらなくなった。

## Differences between the extensions are unified

- **決定**: 拡張機能が同じことを違うやり方でしていた所は、できる限り違いを無くし、どの拡張機能も同じ形にする。一部の拡張機能にだけ入っていた修正は、残りにも入れる。2026-10-30 に「各拡張機能の今のまま」とした違いも、そろえる対象にする。サイトに固有のものは、そろえない。
- **却下した案**: そろえるかどうかを 1 件ずつ決める。
- **理由**: どちらの形へそろえるかは、下の決定で決まっていて、もう一度問わない。下の決定に無い、利用者に見える動きの判断が出たら、問いとして挙げる。

## The settings list shows `Auto (—)` where Auto is on and no gain is stored

- **決定**: 設定ページの一覧で、Auto がオンで、保存したゲインが無い行は、`Auto (—)` と出す (yt-channel-volume の形)。
- **却下した案**: `Auto (100%)`。

## A type with no field of its own has no stored gain

- **決定**: 古い形の 1 つだけの `gain` と、種類ごとの欄の両方を持つ行で、ある種類の欄が無いとき、その種類は保存値なしとして扱う。古い `gain` を読むのは、種類ごとの欄が 1 つも無い行だけ。
- **却下した案**: その種類に古い `gain` を使う。

## A stored gain is 0 to 600%

- **決定**: 書き込みが保存するのは、0 以上 6 以下の有限のゲインだけ (twitch-channel-volume の形)。yt-channel-volume は、保存するゲインを送る前にこの範囲へ収め、worker は範囲の外の値を受け付けない。
- **却下した案**: 有限の数なら何でも保存する。検査しない。
- **経緯**: yt-channel-volume は、保存値を 6.0 で丸めないと決めていた ([yt-channel-volume #52](https://github.com/semnil/yt-channel-volume/pull/52))。どの拡張機能も 1 つの範囲を持つように、その決定はここで取り下げた。yt-channel-volume だけが 600% を超える値を受け付ける案と、yt-channel-volume がそういう保存を断る案は採らなかった。

## A refused or failed popup action raises one notice

- **決定**: 操作が断られたときも、保存に失敗したときも、popup は `gainSaveFailed` を出して状態を読み直す (twitch-channel-volume の形)。
- **却下した案**: 保存の失敗だけを知らせ、操作が断られたときは知らせずに読み直す。

## A drag on the popup's slider is heard as it moves

- **決定**: popup のスライダーをドラッグしている間、値をプレビューとして音に出す。ボタンを押したままの間は、プレビューを 1 秒ごとに送り直す。
- **却下した案**: どの拡張機能でも、スライダーを離すまで音に出さない。

## A gesture saves only where it moved the value

- **決定**: 保存していないプレビューが残ったままキーを離したとき、またはフォーカスが外れたときは、値が動いていたときだけ保存する。残ったプレビューは、入力が止まって 2 秒で保存値に戻る。
- **決定**: 設定ページの Target LUFS も同じ規則にする。キーを押し続けている間に値が始めの値へ戻ったときも、キーが値を動かしていれば書き込む。保存済みと同じ値の書き込みは、ページが値を比べて止めるのではなく、書き手の側で省く。
- **却下した案**: プレビューが残っていれば、いつも保存する。

## A press of the pointer leaves a key hold to the key

- **決定**: スライダーで矢印キーを押し続けている最中に、同じスライダーをポインターで押しても、押し続けは続ける。キーが動かした値は、キーを離したところで保存する。popup でも設定ページでも同じ。
- **却下した案**: ポインターで押した時点で、押し続けを終える。
- **経緯**: この決定は、ゲインの状態の決定にある 2026-10-30 の扱い (コードが既にそうしていた所では、ポインターで押すと押し続けが終わる) を置き換えた ([gain-state.ja.md](gain-state.ja.md) の「A key hold saves once」)。

## A value key pressed again stays in the hold it is in

- **決定** (2026-11-01): 値を動かすキーを押している最中に、そのキーが繰り返しでなくもう一度押されたら、押し続けの続きとして扱う。`createSliderKeys().press` が押し続けの始まりと答えるのは、値を動かすキーが 1 つも押されていないときだけ ([#28](https://github.com/semnil/channel-volume-core/pull/28))。
- **却下した案**: 新しい押し続けとして扱う。
- **覆す条件**: Chrome がこういう `keydown` を送ることがあるかどうかは、分かっていない。決定は、どちらの場合でも成り立つ。

## A drag's release is taken on the slider

- **決定** (2026-11-01): スライダーの外で離したドラッグの `pointerup` は、popup でも設定ページでも、スライダーで受ける。コードは、押された range の入力欄が、押したポインターを捕まえることを前提にしている。だから、ポインターをどこで離しても、離したことと `change` はスライダーに届く。
- **却下した案**: window で受ける。

## A popup that cannot read the settings shows the reload screen

- **決定** (2026-11-01): popup が設定を読むのに失敗したときは、タブに届かないときと同じ画面 (`#reloadNeeded`) を出す。
- **却下した案**: 表示単位を `%` として描く。そのうえで、設定を読めなかったと知らせる。

## The button of the display unit in use writes nothing

- **決定**: 設定ページで、既に選ばれている単位のボタンを押しても、書き込みは起きない (何も変えない書き込みは省くため)。そのため、保存の失敗で出たエラーの行は、そのボタンを押しても消えない。

## A message the catalog lacks shows its key

- **決定** (2026-10-31): popup と設定ページで、`data-i18n` の要素のメッセージがカタログに無いときは、キーをそのまま出す。`<html lang>` はカタログから設定する。HTML の中でその要素が持つ文字は、キーそのものにする。
- **却下した案**: カタログにメッセージが無いとき、HTML の文字を残す。

## A failed delete on the settings page is told with an alert

- **決定** (2026-10-31): 行の削除、または全部の削除が失敗したとき、設定ページは `alert` で知らせる。
- **却下した案**: コンソールにだけ書く。

## The name a write carries

- **決定** (2026-10-31): 書き込みが行に名前を付けるやり方を共有する。文字でない名前は捨てて、書き込みは続ける。ID そのものと同じ名前では、保存済みの名前を置き換えない。名前の無い新しい行は、ID を名前にする。
- **却下した案**: 名前の付け方を各拡張機能に残す。

## An earlier all-types Auto flag fills only the types without one

- **決定** (2026-10-31): 書き込みの前に、全種類に効いていた古いフラグで、自分のフラグを持たない種類だけを埋め、その後で古いフラグを消す (twitch-channel-volume の形)。
- **却下した案**: 古いフラグで、どの種類のフラグも上書きする (yt-channel-volume の形)。

## The worker's listener is shared, and the message types are not

- **決定** (2026-10-31): ほかの場所に頼まれた書き込みを受ける service worker の受け口を共有する (`createWriteListener`)。受け口は、メッセージが名指す書き込みを引き、断ったときと保存に失敗したときは `reason` を付けて答える。各拡張機能は自分のメッセージの型をそのまま使い、書き込みの表を受け口に渡す。受け口が知らない型のメッセージは `console.warn` で記録し、答えない。ただし、拡張機能が無視すると名指した型は記録しない。`reason` の語は、どの拡張機能でも同じ 1 組にする: `invalid-mutation`・`stored-state-invalid`・`storage-update-failed`・`settings-update-failed`。
- **却下した案**: どの拡張機能も 1 組のメッセージの型を使う (使われていた 2 つの形のどちらか)。知らない型を記録しない。`reason` の語を各拡張機能のままにする。

## The popup asks for the state every second

- **決定** (2026-11-01): popup は、開いている間、1 秒ごとにタブへ状態を聞く (`pollTabState`。twitch-channel-volume の形)。content script は自分からは状態を送らない。同じ状態を 2 回送らないためのキーも、一緒に無くした。
- **却下した案**: 2 通りのままにして、そのキーに Target LUFS を足す。どの拡張機能でも content script が状態を送る。
- **理由**: content script が送る形では、yt-channel-volume のキーに Target LUFS が入っておらず、Auto がオフのときに目標値を変えても、popup へ何も送られなかった。

## The gain overlay is on by default

- **決定** (2026-11-01): 設定に選択が無いとき、どの拡張機能でも、プレイヤーの音量の隣にゲインを表示する (twitch-channel-volume の形)。この設定を一度も保存していない yt-channel-volume の利用者には、このときからゲインの表示が出る。
- **決定** (2026-11-01): 既定値は、ここの 1 つの定数 `DEFAULT_SHOW_GAIN_OVERLAY` にまとめ、各拡張機能の content script と設定ページがそれを読む。設定ページの HTML の `checked` は拡張機能に残し、拡張機能のテストが定数の値と合っていることを見張る ([#48](https://github.com/semnil/channel-volume-core/pull/48))。
- **却下した案**: 既定値を拡張機能ごとにする。どの拡張機能でもオフにする。

## The popup's presets are shared

- **決定** (2026-11-01): プリセットのボタンは、共有の `bindPresets` がつなぐ。各ボタンは、自分のパーセントを `data-vol` に持つ ([#44](https://github.com/semnil/channel-volume-core/pull/44))。
- **経緯**: それまでは各拡張機能に残していた。それは、聞かずに置いた扱いで、決定ではなかった。
