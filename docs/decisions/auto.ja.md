# Auto decisions

[English](auto.md)

Auto がレベルからゲインを決めるやり方について閉じた判断。共通コードが何をするかは [shared-files.ja.md](../shared-files.ja.md#gain) の「ゲイン」と「`core/loudness.js`」に、各拡張機能がそれをどう使うかはその拡張機能の `CLAUDE.md` にある。

## Auto follows the level directly

- **決定** (2026-11-01): yt-channel-volume と twitch-channel-volume の Auto は、レベルが求めるゲインを、上げるときも下げるときも同じようにかける。かけ直すのは `AUTO_FOLLOW_INTERVAL_MS` (1000 ms) に 1 回まで。twitch-channel-volume は `applyAutoGain` をこの間隔に間引く。yt-channel-volume は配信のレベルをこの間隔のタイマー (`syncLiveFollow`) で読み直し、配信のレベルが分かるまでは、前と同じく保存したゲインをかける ([#45](https://github.com/semnil/channel-volume-core/pull/45)、[yt-channel-volume #128](https://github.com/semnil/yt-channel-volume/pull/128)、[twitch-channel-volume #139](https://github.com/semnil/twitch-channel-volume/pull/139))。
- **理由**: レベルとゲインの間に入れていた調整よりも、レベルが分かりしだい追従するほうが、聴いた感じが良いと判断した。この記録は、ゲインをもう一度遅らせる提案が、一度退けた案だと知ったうえで出されるように置いている。
- **経緯**: 外した調整は 3 つ。今のゲインより大きいゲインは、30 秒に 1.5 dB までしか上げなかった。急な上昇は切り下げた: twitch-channel-volume は、short-term のラウドネスが Integrated より 6 dB 大きいとき、レベルがもっと大きいものとしてゲインを計算し、yt-channel-volume は、前の値より 1 dB 大きいレベルを 3 dB 大きいものとして扱った。yt-channel-volume は、配信の最初のゲインを保存したゲインの 3 dB 上までに抑えた。twitch-channel-volume がこの形を取ったのは 2026-10-28 ([twitch-channel-volume #91](https://github.com/semnil/twitch-channel-volume/pull/91)) で、そのときに比べた案も一緒に無くなった。yt-channel-volume のゆっくり上げる処理が何を起点に数えるかについての 2026-10-29 の決定 3 つ (プレビューの最中、新しいチャンネルの最初のライブのゲイン、同じチャンネルの配信へ戻るとき) も、その処理と一緒に無くなった。
- **覆す条件**: 判断を 1 つ待っている。レベルに直接追従するゲインで、twitch-channel-volume の音が実際にどう聞こえるかは、聴いて判断していない。聴いて問題が見つかったら、上げる速さをもう一度制限するかを検討し直す。

## A level at or below -45.6 LUFS is no level

- **決定** (2026-11-08): -45.6 LUFS 以下のレベルは、レベル無しとして扱う。表示せず、Auto は追従せず、保存したゲインをかける。-45.6 は、最大のゲイン (+15.56 dB) をかけても最低の Target LUFS (-30) に届かなくなる境目。床は、Integrated のレベルとシード (`core/loudness.js` の `LEVEL_FLOOR_LUFS`) と、拡張機能がほかから受け取るレベル (`core/common.js` の `LEVEL_FLOOR_LKFS` と `levelAboveFloor`) に掛ける。2 つの数が同じであることはテストが見張る。窓ごとの絶対ゲートは -70 LUFS のまま ([#51](https://github.com/semnil/channel-volume-core/pull/51)、[#52](https://github.com/semnil/channel-volume-core/pull/52))。
- **決定** (2026-11-08): 床以下の測定値の隣に保存された Auto のゲインは、そのバージョンにかかわらず使わない (`gainTookNoLevel`)。
- **決定** (2026-11-08): yt-channel-volume は、無音を読み取ったら、手元のレベルと Auto が使うレベルの両方を消す。片方だけを残すと、Auto をオンにしたときに、古いレベルから出したゲインをかけて保存した ([yt-channel-volume #137](https://github.com/semnil/yt-channel-volume/pull/137))。
- **理由**: 音源は、無音を、どのゲインでも届かないほど低いレベルとして知らせることがある (yt-channel-volume の `CLAUDE.md` の「A live stream's own level」)。popup はそのレベルをラウドネスとして表示し、そのレベルが求めるゲインは有限の数にならないので、`gainForLevel` は 1 を返した。床や絶対ゲートを変えるときは、床を窓ごとに掛けない。理由は、下の却下した案の 1 つ目。
- **却下した案**: 床を窓ごとに掛ける。これが最初の形だった (#51)。静かな区間のある番組では、その区間の窓が外れ、Integrated のレベルが番組の実際より大きく読まれた。#52 で、床を Integrated のレベルとシードに掛ける形へ移した。Auto のゲインの隣に、そのゲインを計算したもとのレベルを保存して、レベルから出したゲインとそうでないゲインを見分ける。変更が大きいので採らなかった。
- **受け入れた代償**: 床以下の測定値の隣にある、レベルから出した新しい Auto のゲインも、床より上の測定値が保存されるまで使われない。
- **覆す条件**: 確認を 1 つ待っている。実際に無音の配信で、拡張機能を動かして確かめてはいない。無音の配信でラウドネスが表示された、または Auto がゲインを動かした、という報告が来たら見直す。twitch-channel-volume が床のために変えた行は、後から変異テストに掛け、生き残った変異は無かった。
