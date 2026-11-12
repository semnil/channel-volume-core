# Interface decisions

[English](ui.md)

popup と設定ページについて閉じた判断のうち、どの拡張機能にも当たるもの。これらのページのうち拡張機能が共有する部分は、[shared-files.ja.md](../shared-files.ja.md#popup) の「popup」「設定ページ」「スライダーの操作」にある。

## The extensions share one look

- **決定**: 拡張機能は 1 つのシリーズで、popup と設定ページは次の点をそろえる:
  - 配色: 背景 `#1a1a2e`、より深い `#0f0f23`、パネル `#16213e`、アクセントは青緑 `#4ecdc4`・黄 `#f9ca24`・ピンク `#ff6b9d`。
  - popup: ヘッダー (題名と、設定を開く歯車)、情報の区画 (チャンネルの名前、種類のバッジ、1 行に並ぶ 3 枚のカード: Integrated・Suggested・Current)、適用の区画、手動の区画 (スライダーと 6 つのプリセット: 0・50・100・200・400・MAX)。
  - 設定ページ: 見出しの下に区画のカード (`#1a1a2e`、角の丸み 10px) を並べ、Target LUFS、表示単位の切り替えボタン、保存したチャンネルの表を置く。
  - どちらも持つメッセージの名前 (`targetLufs`・`displayUnit`・`savedChannels`・`applyToChannel`・`clearAll`・`manualVolume` など)。
- **決定**: 1 つの拡張機能の画面を変えるときは、ほかの拡張機能の同じ画面と見比べて、名前・配色・並びをそろえる。1 つのプラットフォームにしか無いもの (広告、ライブか VOD かの種類) を popup に出すときも、カードの並びは崩さない。
- **理由**: 拡張機能は、チャンネルごとの音量という 1 つのことを、別々のサイトで行う。1 つのシリーズとして見え、読めるようにする。

## A value only one platform has does not get a popup card

- **決定**: ほかの拡張機能に無いカード・行・数値は、popup に足さない。要ると思ったときは、足す前に問いとして挙げる。補助の値は拡張機能の状態にとどめる。読む場所は、設定ページか開発のときのログ。
- **経緯**: twitch-channel-volume の popup をほかの拡張機能にそろえる作業の中で、その拡張機能が測る Momentary と Short-term のラウドネスをカード 2 枚として出し、そのカードはもう一度外した (外したコミットは [twitch-channel-volume #13](https://github.com/semnil/twitch-channel-volume/pull/13) に名前がある)。Suggested と Current は、ほかの拡張機能にもあるので残した。
- **理由**: シリーズとして画面をそろえたい。popup がプラットフォームごとに大きくなっていくことは避ける。

## Polling may write a control the viewer cannot operate

- **決定**: 規則は `CLAUDE.md` の「Conventions」にある。決め手は、その瞬間に視聴者がそのコントロールを操作できるかどうか。1 つの要素を書くのは 1 つの経路だけにする。
- **理由**: コントロールをポーリングで書き換えない、という一般の規則が防いでいる害は、ドラッグの途中で値が引き戻されること。popup は、Auto がゲインを握っている間、手動のスライダーとプリセットのボタンに `disabled` を付ける (各拡張機能の `popup.js` の `manualDisabled`)。`disabled` のコントロールはドラッグを受け付けないので、ポーリングが引き戻すドラッグが無い。その間は、ポーリングのたびに、今かかっているゲインへ合わせるのが正しい。合わせないと、鳴っているゲインとスライダーの表示がずれる。
- **実害の記録**: 規則を「操作できる種類の要素は、一律にポーリングで書き換えない」と書いていたとき、Auto がオンの間に popup をゲインへ追従させる変更が、レビューで回帰と判定されかけた。同じ変更で、Current のカードを 2 つの経路が書いていることをレビューが見つけ、1 つの経路から書く形にした ([twitch-channel-volume #4](https://github.com/semnil/twitch-channel-volume/pull/4))。

## Muted text is `#999`

- **決定** (2026-08-21): popup と設定ページの淡い色の文字は `#999` にする。置き換えた宣言、それぞれのコントラスト比、`#888` を採らなかった理由、対象にしなかったものは、[twitch-channel-volume #4](https://github.com/semnil/twitch-channel-volume/pull/4) にある。
- **決定** (2026-11-12): この色は twitch-channel-volume だけのものではなく、シリーズの色とする。yt-channel-volume も、スクリーンショットを描き直す別のプルリクエストで、この色にする。
