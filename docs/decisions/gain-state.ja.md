# Gain-state decisions

[English](gain-state.md)

ゲインや設定が変わり、保存されるまでの経路について閉じた判断。2026-10-25 から 2026-10-31 の間に、拡張機能に共通していた不具合 (握りつぶされていた失敗、競合する書き込み、意味の無い繰り返しの書き込み) を直したときに決めた。これらの経路が今何をするかは、各拡張機能の `docs/gain-change-and-save.md` と [shared-files.ja.md](../shared-files.ja.md) にある。下で名前を挙げる部分のいくつかは、その後 `core/common.js` へ移った。後の決定で置き換わったものは、その節に書いてある。

## The design document changes in the commit that changes the behaviour

- **決定** (2026-10-25): 各拡張機能の `docs/gain-change-and-save.md` とその日本語版は、その拡張機能の修正と一緒に入れた。経路の動きを変える修正は、同じコミットで文書も直す。
- **却下した案**: 文書を修正より先に出す。修正の後に、文書をまとめて出す。

## A failed apply is reported

- **決定** (2026-10-25): yt-channel-volume の `content.js` で `.catch` の無かったつながりは、移動の後の最初の適用と同じく `reportFailure` に回す。`commitGain` は、音声の経路がつながってから `currentGain` を変える。Auto の経路の例外も捕まえて、同じように報告する。

## A settings save that fails puts the control back and says so

- **決定** (2026-10-25): yt-channel-volume の設定ページで、Target LUFS・ゲインの表示・表示単位の変更は、保存が終わるのを待つ。保存に失敗したら、操作部品を保存値に戻し、`settingsSaveFailed` を出す。文言と出し方は、twitch-channel-volume が既に持っていたものに合わせる。
- **決定** (2026-10-29): 保存に失敗し、続く読み直しにも失敗したときは、どの拡張機能も `settingsLoadFailed` を出す。「保存済みの値へ戻した」というお知らせは出さない (そのときは戻っていない)。
- **却下した案**: Auto の既定値のトグルがしていたように、知らせずに戻すだけにする。

## A preview holds off every other gain

- **決定** (2026-10-25): yt-channel-volume では、popup からのプレビューが鳴っている間、ほかのきっかけで届いたゲインをかけない。操作の終わり (その `change` か保存が届いたとき、またはプレビューが止まったとき) に、content script が最新の保存値と比べる。断られた操作の後は、最新の保存値をかけて知らせる。
- **決定** (2026-10-25 から 2026-10-28): ボタンやキーを押している間は、操作を終えない。popup は 1 秒ごとにプレビューを送り直し、content script は、最後のプレビューが届いてから 2 秒でプレビューを終える。
- **決定** (2026-10-29): twitch-channel-volume も同じ形にする。プレビューの間は、ストレージの変更でゲインをかけ直さない (キーを押している最中に、そのタブ自身の測定値の保存が、保存済みのゲインへ戻していた)。プレビューの間は、測定から来る Auto のゲインもかけない。
- **却下した案**: popup の側が、届いたものを無視する。両方の側で守る。2 秒の終わりについて: 間に届いたものがあればそれを、無ければプレビューをかけ続ける。必ず保存値に戻す。twitch-channel-volume について: 保存が届くまでかけ直さないだけにして、送り直しと 2 秒の終わりは足さない。

## A change the settings start is made again once where it was overtaken

- **決定** (2026-10-25): yt-channel-volume では、設定の変更が始めた適用が、途中でストレージが動いて捨てられたとき (`storageRevision`)、読み取りが落ち着いた後で 1 回だけやり直す。これを補うために、チャンネルの通知のたびに保存を足すことはしない。
- **決定** (2026-10-25): twitch-channel-volume は、起動と移動のときに、「シードつきの測定のリセットがまだ」の印 (`seededResetPending`) を立てる。印が立っている間は、勝った側の読み直しがそのリセットを送る。
- **決定** (2026-10-25 から 2026-10-28): 持ち主のイベントで測る対象が変わったときにも、この印を立てる。
- **決定** (2026-10-25 から 2026-10-28): twitch-channel-volume でも、設定の変更が始めた読み直しが追い越されたときは、落ち着いた後で、読み直しと Auto のゲインの保存を 1 回やり直す。
- **却下した案**: 追い越された読み直しを、定期の測定値の保存に任せる。印を立てるのを起動と移動のときだけにする。

## The settings are written by the service worker, a field at a time

- **決定** (2026-10-25): yt-channel-volume は、twitch-channel-volume の `settings-store.js` と同じく、設定を service worker の列を通して項目ごとに書く。
- **決定** (2026-10-25 から 2026-10-28): worker は、書くように頼まれた値を確かめ、範囲の外の Target LUFS、`%` と `dB` 以外の単位、真偽値でないトグルを断る。
- **却下した案**: 確かめずに書く。

## A key hold saves once

- **決定** (2026-10-25): popup のスライダーでキーを押している間は、プレビューだけを送り、ゲインは `keyup` で 1 回保存する。設定ページの Target LUFS も、キーを押している間は表示だけを変え、`keyup` で 1 回書く。キーを押したまま `blur` したら、そこで押し続けを終えて保存する。
- **決定** (2026-10-30): 押し続けを始め、続けるのは、range の入力欄の値を動かすキー (矢印キー、PageUp と PageDown、Home と End) だけ。ドラッグ中に Tab を押すと、そのドラッグが保存されなかった。
- **決定** (2026-10-30): 押している値のキーを数え、最後の 1 つを離したところで 1 回保存する。矢印キーを押し続けている最中に別の矢印キーを離すと、保存が 1 回にまとまらなかった。
- **決定** (2026-10-30): twitch-channel-volume の、広告中のゲインのスライダーも、Target LUFS のスライダーと同じ形にする。キーを押し続けると、繰り返しのたびに書いていた。
- **却下した案**: content script が書き込みを遅らせる。繰り返しのたびに書くままにする。
- **経緯**: 「コードが既にそうしている所では、ポインターで押すと押し続けが終わる」という 2026-10-30 の扱いは、2026-10-31 に置き換わった。どの拡張機能でも、押し続けは続く ([shared-code.ja.md](shared-code.ja.md) の「A press of the pointer leaves a key hold to the key」)。

## A blur ends the gesture

- **決定** (2026-10-25): popup のスライダーのドラッグは、popup がフォーカスを失ったところで終える。`blur` の時点の値を保存し、次に押すまで `input` と `change` を無視する。twitch-channel-volume では、これでドラッグの途中の移動の場合も起きなくなる。
- **決定** (2026-10-25 から 2026-10-28): 無視した `change` では、どの拡張機能でも、つまみを `blur` のときに保存した値へ戻す。「次に押す」は、`pointerdown` か、繰り返しでない `keydown`。
- **決定** (2026-10-30): 設定ページのスライダーも同じ形にする。つまみを押している間の `blur` で操作を終えて 1 回書き、その後の `input` は無視し、`change` ではつまみを書いた値へ戻す。
- **決定** (2026-10-30): つまみそのものの `blur` (ドラッグの途中で Tab を押したとき) でも、popup と設定ページのどのスライダーも、ドラッグを終える。Tab の時点の値で 1 回保存し、その後のドラッグは捨てる。
- **却下した案**: ドラッグを続けさせる。`blur` でドラッグを取り消す。無視した `change` の時点の位置につまみを残す。次に押す操作を `pointerdown` だけにする。window の `blur` だけで終える。

## A write that changes nothing is left out

- **決定** (2026-10-25): 中身が変わらない書き込みはしない。twitch-channel-volume では、同じ持ち主についての持ち主のイベントの繰り返し、既に整っている状態への `normalizeChannels`、今と同じ値の設定の保存。どの拡張機能でも、既に選ばれている表示単位のボタン。
- **決定** (2026-10-25): twitch-channel-volume の、今と同じ値のゲインの保存と、変わらない測定値の保存は、省かない。それらが進める版・通し番号・`lastMeasuredAt` に意味がある。
- **却下した案**: 版が進むだけの書き込みも省く。

## A settings change saves Auto's gain only where the target or Auto's default changed

- **決定** (2026-10-25): yt-channel-volume と twitch-channel-volume で、設定の変更が Auto のゲインを保存するのは、Target LUFS か Auto の既定値が変わったときだけ。ゲインのかけ直しは前と同じ。表示単位、ゲインの表示、twitch-channel-volume の広告中のゲインの変更では、保存しない。
- **却下した案**: 目標値が変わったときだけ保存する。twitch-channel-volume が設定の変更で保存するのをやめる。

## Only a tab that is playing writes

- **決定** (2026-10-25): 同じチャンネルを 2 つのタブで開いているとき、Auto の自分の保存 (yt-channel-volume) と測定値の保存 (twitch-channel-volume) をするのは、メディアが止まっておらず、ミュートでもないタブだけ。音量が 0 (要素の音量が 0、または拡張機能のゲインが 0%) でも、再生中に数える。
- **決定** (2026-10-25 から 2026-10-28): yt-channel-volume で、最後の適用の後に再生が始まったタブは、次の適用を待たずに、`play` のイベントで Auto の自分の保存をする。
- **決定** (2026-10-30): twitch-channel-volume で、設定の変更が始める Auto のゲインの保存も、再生中のタブだけが送る。
- **却下した案**: 上書きを仕様として残す。音量 0 のタブを再生中から外す。

## Nothing is saved for a new URL from a message until its first apply is done

- **決定** (2026-10-25): yt-channel-volume では、新しい URL の最初の適用が終わるまで、届いたメッセージでは保存しない (ライブの保存も、Auto の保存も)。「まだ返事が無い」答えの `isLiveContent` が false のときは、「分からない」として扱う。
- **決定** (2026-10-25 から 2026-10-28): 止めるのは、メッセージがきっかけの保存だけ。設定の変更、popup を開いたこと、`play` がきっかけの保存は止めない。
- **却下した案**: 最初の適用より前の保存を、きっかけによらず全部止める。2026-10-29 に同じ問いが戻ったときも、2026-10-30 に [yt-channel-volume #82](https://github.com/semnil/yt-channel-volume/pull/82) のレビューが「最初の適用より前の `play`」を挙げたときも、狭いほうの形のままにした。
- **経緯**: ライブのレベルを持つメッセージが最初の適用より前に届くことがあるかどうかは、調べていない。直し方は、どちらの場合でも同じ。

## A popup action is refused until the channel of the URL's video is known

- **決定** (2026-10-25): yt-channel-volume では、新しい URL が名指す動画についてチャンネルが決まるまで、popup からの操作を `state moved` で断る。popup は、ほかの断りの後と同じく状態を読み直す。
- **経緯**: この守りが要る場合はサイトでは見つからなかったが、守りは残した (2026-10-25 から 2026-10-28)。

## The fetch hook takes only the player response of the URL's video

- **決定** (2026-10-25 から 2026-10-28): yt-channel-volume の fetch のフックは、`/youtubei/v1/player` の応答のうち、URL の動画の `videoDetails` を持つものだけを受け取り、ほかは捨てる。コードは、ライブのページがほかの種類のプレイヤーの応答も受け取ることを前提にしている。その応答が、種類を動画へ戻していた。

## The DOM's channel is not used after a navigation until the bridge names the video's channel

- **決定** (2026-10-25 から 2026-10-28): yt-channel-volume では、移動の後、ブリッジがその動画のチャンネルを名乗るまで、DOM が示すチャンネルを使わない。コードは、DOM が前のページのチャンネルを示し続けることがあるのを前提にしている。
- **却下した案**: 守りを入れない。DOM がそうなるかどうかを、サインインしたブラウザで先に確かめる。

## A channel's live URL takes the video of the canonical link

- **決定** (2026-10-28): yt-channel-volume は、チャンネルのライブ URL の動画を、ページの canonical リンクから読む。プレイヤーの応答が同じ動画を名指すまで待つ守りは入れない ([yt-channel-volume #72](https://github.com/semnil/yt-channel-volume/pull/72))。コードは、そういう URL へ入るとページが読み込み直されることを前提にしている。だから、そのリンクは新しいページのものになる。
- **却下した案**: canonical リンクの ID がプレイヤーの応答の `videoId` と一致するまで、動画を「分からない」として扱う。

## An owner response with no video id is not taken

- **決定** (2026-10-25 から 2026-10-28): twitch-channel-volume のブリッジは、動画を名指さない持ち主の応答を、今の画面の VOD の持ち主として受け取らない。
- **却下した案**: そう受け取る分岐を残す。

## A player swapped in during a preview is connected at once

- **決定** (2026-10-30): yt-channel-volume では、プレビューが鳴っている最中にプレイヤーが入れ替えた `<video>` を、次のプレビューのメッセージを待たずに、その場で音声の経路につなぐ ([yt-channel-volume #86](https://github.com/semnil/yt-channel-volume/pull/86))。twitch-channel-volume は、新しい要素をブリッジの 1 つの `GainNode` につなぐので、このすき間が無い。

## A change notice during a press leaves the thumb alone

- **決定** (2026-10-30): 設定ページで、スライダーのつまみを押している間に届いた、前の保存の変更通知からは、目標値だけを取り込む。つまみにも、そのラベルにも触れない。それまでは、通知がつまみを保存した値へ戻し、押している値が失われていた ([yt-channel-volume #86](https://github.com/semnil/yt-channel-volume/pull/86)、[twitch-channel-volume #99](https://github.com/semnil/twitch-channel-volume/pull/99))。
- **決定** (2026-10-31): ポインターを、押したときと同じ値で離したとき (`change` が出ないとき) は、ページが目標値を描く。`blur` で終えた押下も、目標値を描く。
- **経緯**: 2 つ目は、初めは別のプルリクエストへ回すと決めた。開いているプルリクエストが、`main` にこの欠陥の無い拡張機能へ欠陥を持ち込むと分かり、開いているプルリクエストに入れた。

## What the documents say about sync follows Chrome's documentation

- **決定** (2026-10-28): 「設定が利用者のほかのコンピューターへ届く」という記述は、Chrome の `chrome.storage` のドキュメントが挙げる条件 (同期を有効にしていること、同じアカウントでログインしている Chrome であること) で書き、そのページへのリンクを添える。2 台のマシンで動かして確かめることはしない。
- **決定** (2026-10-29): 開発者向けの文 (`CLAUDE.md`、コードのコメント) と、利用者向けの文 (README とプライバシーポリシー。どちらの言語も) の両方を、同じ言い回しにする。
- **却下した案**: 記述を外す。開発者向けの文だけを直す。

## What stands on a specification or a scripted run

- **決定** (2026-10-28 から 2026-10-30): 次のものは、そのままにした。確かめた範囲より広く受け取られないように、記録しておく。
  - Chrome が `keydown` と `keyup` で値のキーに付ける名前 (`ArrowLeft` など、`Tab`) は、W3C UI Events の key の値から取った。本物のキーボードでは確かめていない。
  - ストレージへの書き込みが失敗する場合のうち、起こしたのは `storage.sync` の書き込み回数の上限だけ。`storage.local` の容量の上限は起こしていない。
  - `settingsLoadFailed` (保存が断られ、その後の読み直しも失敗する場合) は、テストの中でだけ起こした。ブラウザでは起こしていない。
  - ドラッグの途中で Tab を押したときのイベントの順は、スクリプトの入力によるもの。本物のマウスとキーボードによるものではない。
  - 設定ページのスライダーでキーを押したまま別のアプリへ切り替える場合は、キーボードでの切り替えだけを試した。別のウィンドウをクリックする切り替えは試していない。

## A pull request is swept on the lines it changes

- **決定** (2026-10-30): プルリクエストでは、変えた行だけを変異テストに掛ける。ソースの全体に掛けるのは、プルリクエストとは切り離して、ときどき行う。
- **理由**: この修正のために全体に掛けた回では、新しい穴は全部 1 回目に見つかった。2 回目より後は、何時間も掛かって 1 つも見つからなかった。
- **決定** (2026-10-29): この修正のために全体に掛けて生き残った変異は、`main` に前からあったものも含めて、同じプルリクエストで扱った。テストで落とせるものは、そのコードを入れたコミットにテストを足した。コードを使う側から違いが分からないもの (誰も読まない戻り値、受け手の最後の `await`) は、記録せずに、コードからその書き方を外した。残ったものは、理由つきで `equivalents.md` に記録した。
- **却下した案**: プルリクエストごとに全体に掛ける。変異テストをやめる。ブランチの先端に、テストだけのコミットを足す。前からあった生き残りを後回しにする。

## Coverage is reported to Codecov

- **決定** (2026-10-31): テストを `NODE_V8_COVERAGE` を付けて動かし、`tools/coverage/v8-to-lcov.mjs` が、V8 の残した記録を、パッケージに入る JS ファイルの lcov の報告にする。それを `codecov/codecov-action` が送る。公開リポジトリは、トークン無しで送る。
- **決定** (2026-10-31): Codecov のチェックは既定のままにする。project のチェックは、カバレッジが base より下がると失敗する。patch のチェックは、変更のカバレッジが base の全体の値を下回ると失敗する。
- **決定** (2026-10-31): 送るのに失敗したら、テストのジョブを失敗にする。
- **却下した案**: Node 自身のカバレッジの値を CI で集める。patch のチェックを 100% にする。チェックを知らせるだけにする。送るのに失敗しても通す。
- **経緯**: 今は、送るのに失敗すると、プルリクエストではジョブが失敗し、`main` への push では緑のままになる ([shared-files.ja.md](../shared-files.ja.md#workflows) の「ほかのワークフロー」)。
