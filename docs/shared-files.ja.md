# 共通ファイル

[English](shared-files.md)

`shared/` の各ファイルが拡張の中で何をするか。各拡張の文書は、その拡張がこれらのファイルに何を渡しどう使うかを書き、それ以外はここを指す。拡張がどのファイルを受け取るか、変更がどう届くかは [README](../README.ja.md) にある。

<a id="shared-code"></a>
## 共通コード: `core/common.js`

各拡張が自分のスクリプトより先に読み込むクラシックスクリプト。拡張の `utils.js` を読み込む場所 (popup・設定ページ・content script・service worker) ではどこでも先に読み込まれ、トップレベルの宣言はそこでのグローバルになる。拡張ごとに違うもの (ストレージの領域とキー、メッセージの型、書き込みの表、ページの要素) は呼び出し側が渡す。

<a id="settings"></a>
### 設定

- `SETTINGS_KEY`・`DEFAULT_TARGET_LUFS`・`MIN_TARGET_LUFS` / `MAX_TARGET_LUFS` (-30, -6)・`DEFAULT_SHOW_GAIN_OVERLAY` (true)・`DEFAULT_AUTO_APPLY_LOUDNESS` (false): 設定オブジェクトを置くキー、Target LUFS の既定値とその範囲、設定に選択が無いときにプレーヤーの音量のそばへゲインを表示するかどうか、持ち主の行にも設定にも選択が無い種類で Auto をオンにするかどうか。
- `readSettings`・`isStoredSettingsObject`: sync の設定オブジェクト。sync に無い間は local の写し。local も空で返ったときは、sync をもう一度読む。2 回の読み取りの間に移し替えが入りうる (sync を空と読んだ後、移し替えが sync に書いて local を消す) ので、その読み取りで移し替えが sync に置いたものが見つかる。どちらにも設定オブジェクト (null でも配列でもないオブジェクト) が無ければ `{}`。
- `moveSettingsToSync`: 以前の版が local に置いた設定を sync へ移す。sync にすでに設定があれば (Chrome の同期がオンで、同じユーザーでサインインした別の Chrome が先に移した)、それを残して local の写しを消す。sync に書いてから local を消すので、読む側はいつでもどちらかで見つける。sync が書き込みを断ったときは local をそのまま残し、次に任せる。書く前に sync を読むので、その間に届いた設定の保存は local の写しで上書きされる (設定を保存する呼び出し側は、保存と移し替えを 1 つの列で走らせる)。同じ local の写しを読み、`keep` から同じものを受け取る 2 つの移し替えは、同時に走っても同じ値を書く。local の設定のうち何を書くかは呼び出し側の `keep` が決める。local に何かあったかどうかを答え、何も無ければ移し替えは 1 回の読み取りで終わる。
- `createSerialQueue`: 処理を 1 つずつ順に走らせる。失敗しても次へ進み、それぞれが終わった時点で答える。
- `writeSettingsChange`・`sameStoredSettings`・`settingCheck`: 読んだ設定への変更を sync へ書く。読んだ値と sync がすでにそれを持っていれば書かない。表に載った項目の検査を返し、載っていない名前には何も返さない。

<a id="stored-map"></a>
### 持ち主の一覧とその行

- `createStoredMapWriter`: `storage.local` のキーに置いた一覧 (拡張の持ち主とそのゲイン) を書く。専用の列で 1 回ずつ書くので、各書き込みは前の書き込みが残したものを読み、失敗した書き込みがあっても次は止まらない。書き込みは一覧を読み、`mutate` にその場で変えさせ、変わったとき (変えた後の一覧を文字にしたものが、読んだもの (キーが無ければ `{}`) と違うとき) だけ書き戻す。`extraKeys` があれば、`mutate` が何をしたかに関わらず一緒に書く。実行環境に届かなくなった場所からは何も書かない。
- `MIN_GAIN` / `MAX_GAIN` (0, 6)・`clampGain`・`isStorableGain`: ゲインの範囲と、書き込みが保存してよいゲイン (その範囲の有限の数)。
- `storedGain`・`expandLegacyGain`・`hasTypedGain`: 行の種類ごとのゲイン。以前の単一のゲインは、種類ごとの項目がどれもキーに無いときだけ、有限の数であるときだけ読み、書き込みのときに写す。
- `applyEntryName`: 書き込みが運んできた名前で行に名前を付ける。文字列でない名前、空の名前、id そのもの (送り手は名前を知る前に id を送る) は、行の名前を変えない。名前の無い行は、`nameNewRow` (呼び出し側が指定しなければ true) が求めれば id を名前にする。
- `expandLegacyAutoFlag`・`autoFlagFor`: 以前の全種類共通の Auto のフラグは、自分のフラグを持たない種類だけを埋める。種類の Auto の状態は、自分のフラグ、以前のフラグ、呼び出し側の `storedGainTurnsOff` が通すとき (フラグの無い保存ゲインをそれだけで選択とみなす規則) はオフ、既定値の順に決まる。
- `setAutoFlag`・`hasAutoFlag`: 以前のフラグを呼び出し側の項目の種類ごとのフラグに展開してから、種類の Auto のフラグを true か false で書く。行がその種類の Auto の選択を持っているか (自分のフラグか以前のフラグ。自分のプロパティだけを見る)。
- `isRowKey`・`rowLabel`: 削除が指してよいキー (空でない文字列)。行を表示し並べる名前 (空でない文字列の名前があればそれ、無ければキー)。

<a id="writes"></a>
### ほかの場所に頼まれて worker が行う書き込み

- `createWriteListener`: ほかの場所が頼む書き込みを受ける service worker のメッセージの受け手。メッセージが頼む書き込みは、呼び出し側の `route` が `{ write, label, failed }` で返す (無ければ返さない)。書き込みが返した結果は `ok: true` で答える。拒否は `ok: false` と、拒否が持つ理由 (`WriteRefused` なら `invalid-mutation`、ほかに `reason` を持っていればそれ) で答え、理由が無ければ `failed` (保存の失敗) で答える。呼び出し側の接頭辞と書き込みの label を付けて記録する (`rejected as invalid`、`stored-state-invalid` なら `blocked by the stored state`、それ以外は `failed`)。書き込みを頼まないメッセージには答えず (ほかの場所の受け手が答えられるように)、型が `ignoredTypes` に無ければ記録する。
- `tableWrite`: 呼び出し側の接頭辞の後ろの名前が指す、表の書き込み。
- `requestWrite`: ページやタブからの書き込みの依頼。書き込みが済めば worker の答えで解決し、そうでなければ答えた理由 (理由が無ければ `write not confirmed`) で拒否する。

<a id="gain"></a>
### ゲイン

- `isContextValid`: 拡張の実行環境にまだ届くかどうか。
- `isMediaPlaying`: メディアが一時停止もミュートもしていないかどうか。音量 0 やゲイン 0 は再生中とみなす。
- `isManualGainLocked`: Auto がゲインを持っていて手動の操作部品が何も受けないかどうか。Auto がオンで、追う値が分かっているとき。
- `createUnaskedWriteReporter`: 操作で頼まれずにページが行う書き込み (次の同じ種類の書き込みがやり直す) の失敗の記録係。名前ごとに一続きを持ち、最初の失敗は info、次の失敗は error で記録し、それ以降は記録しない。その名前の書き込みが済むと一続きは終わる。実行環境に届かないときは記録しない。
- `gainToPercent`・`percentToGain`・`gainToDb`・`formatGain`・`formatGainText`・`formatAutoGain`: ゲインを % や dB にしたり戻したりする。表示単位での数と単位、1 つの文字列、Auto での見せ方 (保存ゲインが無ければ `Auto (—)`)。
- `gainForLevel`: レベルを目標へ合わせるゲイン。`10^((目標 - レベル) / 20)` をゲインの範囲に収め、有限でなければ 1。
- `AUTO_FOLLOW_INTERVAL_MS` (1000 ms): 再生中に動くレベルから Auto がゲインを決め直す最短の間隔。

<a id="pages"></a>
### ページ

- `msg`・`applyI18n`・`esc`: カタログの文言 (無ければキーそのもの)。`data-i18n` を持つ要素をそれぞれの文言で埋め、`<html lang>` を `pageLanguage` から決める。文字列をタグの間と引用符で囲んだ属性の中で安全にする。
- `revealPage`: レイアウトを読み (`document.body.offsetWidth`)、書いた内容をトランジションの止まった状態でレイアウトさせてから、次のフレームで `body.initializing` を外す。同じスタイルの計算の中で外すと、書く前の値がトランジションの始まりになる。
- `runPageLoad`・`PAGE_LOAD_TIMEOUT_MS` (3 秒): ページの最初の読み込み。拒否されたときと期限までに終わらなかったときは失敗とし、答えが出たらページを見せる。

<a id="sliders"></a>
### スライダーの操作

- `SLIDER_VALUE_KEYS`・`isSliderMoveKey`・`createSliderKeys`: 矢印キー・PageUp / PageDown・Home / End。range の値を動かすキーで、キーの押し続けになるのはこれだけ。ほかのキーは関わらない。`createSliderKeys` は 1 つのスライダーで押されているそれらのキーを記録する。どれも押されていないときのそのキーの `keydown` で押し続けが始まり (キーの繰り返しや、別のキーを押している間に押したキーでは始まらない)、押されている最後のキーの `keyup` で終わる。
- `holdSettingsSlider`: 設定ページのスライダーで、キーの押し続け 1 回・ドラッグ 1 回につき書き込みを 1 回にする。操作の間はラベルだけを動かす。キーの押し続けは、キーが値を動かしていれば、最後の値のキーの `keyup` か、それより先に来たスライダーまたはウィンドウの `blur` で 1 回書く。キーの繰り返しごとの `change` では書かない。主ボタンでのドラッグは `change` で書く。何も動かさなかったキーの押し続け、始めた値の上で離したドラッグ、操作を終わらせた `blur` は、保存されている値を描く。キーの押し続け中のポインタの押下は、押し続けとその値をキーに任せる。操作を終わらせた `blur` の後は、次のポインタか値のキーの押下まで `input` と `change` は何も動かさず、`change` は保存されている値を描く。ブラウザが取り消したドラッグ (`pointercancel`) も、キーを押し続けていなければ同じように書かずに終わる。キーもポインタも押していないときの `blur` は何も終わらせない。ドラッグの離しはスライダーで受ける (押したときにポインタを捕まえるので、どこで離しても届く)。キーかポインタが押されているかどうかを答える。
- `holdPopupSlider`・`PREVIEW_KEEP_ALIVE_MS` (1 秒): popup のゲインのスライダーで、キーの押し続け 1 回・ドラッグ 1 回につき保存を 1 回にし、動かしている間は聞こえるようにする。操作は、スライダーでの主ボタンか値のキーの押下、または進行中の操作が無いときの `input` か `change` で始まる (呼び出し側の `begin` に知らせる)。`input` のたびに値を描き、`canPreview` が通せばプレビューとして送る。まだ保存していないプレビューの後でポインタかキーを押さえている間は、`PREVIEW_KEEP_ALIVE_MS` ごとにプレビューを送り直し、保存したら送らない。ドラッグは `change` で保存する。キーの押し続けは、キーが値を動かしていれば、最後の値のキーの `keyup` で 1 回保存する。キーの繰り返しごとの `change` では保存しない。キーの押し続け中のポインタの押下は、押し続けをキーに任せる。キーが保存した後もその押下は同じ操作のままで、その `change` はキーの後に動かした値を保存し、それ以上動かしていなければ何も保存しない。スライダーかウィンドウの `blur` で操作は終わり、キーが値を動かしていればキーの押し続けはそこで保存する。その後は次の押下まで `input` と `change` は何も送らず、`change` はつまみを `blur` の時点の値へ戻す。ブラウザが取り消したドラッグも、キーを押し続けていなければ同じように保存せずに終わり、何も描かない。プレビューが止まるとタブが持っているゲインを戻し、呼び出し側の `cancel` に知らせる。キーもポインタも押していないときの `blur` は何も終わらせず、ドラッグの離しは設定ページのスライダーと同じくスライダーで受ける。キーかポインタが押されているかどうかを答える。

<a id="settings-page"></a>
### 設定ページ

- `showSettingsError`: `#settingsError` を、カタログの文言で出すか隠す。
- `saveSettingOrRestore`: 操作部品の保存。ページの読み込みが済むまでは何も書かない。書き込みが済めばエラー行を消す。済まなければ設定を読み直して持っている値を描き (その読み取りの間に設定の変更が来ていれば描かない)、`settingsSaveFailed` を出す。その読み取りも失敗したときは操作部品を描いたままにして `settingsLoadFailed` を出す。`<prefix> setting not saved` を記録し、読み取りが失敗したときは `<prefix> settings not read back after a failed save` も記録する。保存が済んだかどうかを答える。

<a id="popup"></a>
### popup

- `setCardValue`・`setUnknown`: カードの値、`span.unit` の中の単位、カードの class。`---` と、渡した class と `unknown`。
- `STATE_POLL_INTERVAL_MS`・`pollTabState`: 最初の問い合わせはすぐに行い、その後は popup が開いている間、1 秒ごとに状態を聞く。
- `sendTabMessage`: popup から自分のタブへのメッセージ。タブを持たないときは断る。
- `createSaveNotice`: ゲインが保存されていないという知らせ。表示中の持ち主に送った最後の保存の答えが ok でなければ出し、ok の答えか、別の持ち主の表示で消す。それより前の保存の答えや、別の持ち主に送った保存の答えは知らせを変えず、持ち主を表示していない popup も変えない。出ている間は、`draw` がヒントに `gainSaveFailed` をエラーの色で入れる。
- `drawOwnerName`: 持ち主の名前。無ければカタログの「未検出」の文言を `empty` の class で出す。全文を title に入れる。
- `isSiteTab`: タブの URL のホスト名が、そのサイトかそのサブドメインかどうか。
- `showPopupStatus`・`hidePopupStatus`: 画面の代わりに、カタログの文言で状態の行を出す。画面を戻す。
- `followDisplayUnit`: 表示単位を一度読み、popup が開いている間は sync の変更に合わせる。読み取りの間に来た変更は、読み取りの結果より優先する。
- `bindPresets`: プリセットのボタン。それぞれ自分の % を `data-vol` に持つ。押されると、呼び出し側の `allow` が通す限り、その % をスライダー・スライダーの値・現在値のカードに表示単位で描き、% とそのゲインを呼び出し側の `pick` に渡す。

<a id="measure"></a>
## 測定: `core/loudness.js`・`audio-worklet.js`

`measure` グループ。ページが再生するメディアのラウドネスを Web Audio API で測る拡張のためのもの。メーターに何を伝えるか (広告が外す窓、音量の変化が飛ばす窓、取り消す窓) は拡張自身のスクリプトが決める。メーターが知っているのは操作で、その理由は知らない。

<a id="loudness"></a>
### `core/loudness.js`

`channelVolumeLoudness` という名前を 1 つだけ宣言し、拡張の API に触れないクラシックスクリプト。そのため拡張は、測るスクリプトより先に、ページ自身のワールド (`"world": "MAIN"` の content script) でも自分のワールドでも読み込める。宣言するオブジェクトと渡す係数は凍結してあり、同じワールドを共有するページからは変えられない。

- `K_PRE_48K`・`K_RLB_48K`・`redesignBiquad`・`kForSampleRate`: BS.1770-4 の K 特性重み付け (プリフィルターの高域シェルフと RLB ハイパス) の 48 kHz での係数。biquad をアナログ形を経て別のレートへ移すもの (書かれたレートで双一次変換を逆にかけ、新しいレートで双一次変換をかける)。あるレートでの 2 つのフィルター。48 kHz から 1 Hz 以内なら書かれた係数そのもの、それ以外は設計し直したもの。
- `meanSquareToLufs`: `-0.691 + 10 log10(ms)`。0 より大きい有限の数でなければ `-Infinity`。
- `normalizeForVolume`: 要素自身の音量より手前で取ったブロックを、音量が 0 と 1 の間 (両端は含まない) なら音量の 2 乗で割る。それ以外はそのまま返す。
- `WORKLET_PROCESSOR`・`buildChain`: `audio-worklet.js` がプロセッサーを登録する名前。ソースノードから、コンテキストのレートに合わせた 2 つのフィルターを通ってそのプロセッサーの `AudioWorkletNode` へ至り (ポートのメッセージ処理は `onBlock`)、そこからゲイン 0 を経て出力先へつながるチェーン。測定の経路は出力に何も足さない。worklet のノードを返す。呼び出し側は先に `audio-worklet.js` をコンテキストへ読み込んでおく。
- `BLOCK_SEC` (0.1 秒)・`MOMENTARY_BLOCKS` (4)・`SHORT_BLOCKS` (30)・`GATE_BLOCKS` (4)・`MAX_INTEGRATED_BLOCKS` (36000、1 時間分の窓)・`MIN_SEED_WINDOWS` (300) と `MAX_SEED_WINDOWS` (1800)・`BOUNDARY_SKIP_BLOCKS` (4): worklet に頼むブロックの長さ、Momentary と Short-term を読むブロック数、ゲーティング窓 1 つのブロック数 (BS.1770-4 の 75% 重なる 400 ms の窓。ブロックごとに 1 窓)、リングが持つ窓の数、シードの下限と上限、境界が外す窓の数。
- `createMeter`: 1 つの測定。
  - `addBlock(ms, hold)`: worklet からのブロック。測る基準の音量へすでに換算したもの。`momentary` と `shortTerm` (直近 4 ブロックと 30 ブロック、足りなければあるだけの平均を LUFS で)、`window` (直近 4 ブロックの平均、つまりこのブロックで完成したゲーティング窓。4 ブロックに満たなければ `null`)、`skipped` (境界のスキップがその窓を取ったか)、`integrated` (`{ lufs, windows }`) を返す。窓はどう扱われても観測済みとして数え、直近のリセットから 1 始まりの番号が付く。`hold` のときは追加せず、境界のスキップもそのまま残す。そうでなく境界のスキップが進行中なら、スキップがその窓を取って残りを 1 減らす。どちらでもなければリングに追加する。リングは `MAX_INTEGRATED_BLOCKS` 個を持つと最も古いものを手放す。絶対ゲート (-70 LUFS) 以上の窓は索引にも入れる。
  - Integrated は、索引にある窓のうち相対ゲート (索引の平均より 10 LU 下) 以上のものの平均で、索引が空なら `-Infinity`。その `windows` は相対ゲートの内側にある窓の数で、シードが両方のゲートの内側にあるとき、シードの分は渡された数として数える。`MAX_SEED_WINDOWS` を上限とする。索引は部分木の和と数を持つ平衡木で、レベルがどの順で来ても O(log n) でゲートを読める。
  - `reset(lufs, windows)`: ブロックとリングを空にし、窓の番号を 1 から振り直す。`lufs` が有限のレベルで、その平均二乗も有限なら、シードを `max(MIN_SEED_WINDOWS, claimed)` 個の番号 0 の項目として置く。`claimed` は、`windows` が正の安全な整数なら `MAX_SEED_WINDOWS` を上限としたその数、それ以外は 0。絶対ゲートより下のシードは索引に入らない。進行中の境界のスキップは続く。
  - `clearBlocks()`: 次のゲーティング窓を次のブロックから始める。Integrated はそのまま。
  - `skipBoundary()`・`boundaryWindowsLeft()`: この後の、`hold` でない `BOUNDARY_SKIP_BLOCKS` 個の窓を Integrated から外す。スキップが進行中なら残りを満数に戻す。残りの数。
  - `windowsObserved()`・`windowsSinceReset()`: 直近のリセットからできた窓の数。そのうち追加され、その後取り除かれていないものの数。
  - `appendedWindowsSince(first)`: リングの新しい側から数えて、窓 `first` 以降から来た項目がいくつ続くか (そうでない項目に当たったところで止まる)。
  - `removeRecentWindows(count)`: リングと索引から新しい項目を最大 `count` 個取り除く。`windowsSinceReset()` とリングにある数を超えないので、シードの項目は取らない。取り除いたそれぞれの平均二乗を古い順に返す。

<a id="worklet"></a>
### `audio-worklet.js`

`k-mean-square` プロセッサー。コンテキストのレートで `processorOptions.blockSec` 秒 (0 より大きい数でなければ 0.1 秒、最低 64 サンプル) のブロックごとに、L² + R² の平均を `{ ms, samples }` として送る。モノラルの入力は 1 つのチャンネルを両側に数える。入力の無いレンダー量子は、すでに測ったブロックの途中までを捨てない。ページのコンテキストへ読み込む拡張は、これを `web_accessible_resources` に載せる。

<a id="mutation"></a>
## 変異テスト: `tools/mutation/`

テストの緑を、緑であること以上のものにする道具。同じ場所の `equivalents.md` は各リポジトリ自身の記録で、共通ではない。

- `sweep.mjs <tree> <source> <test command…>`: ソースから規則で変異を作り、それぞれにテストを走らせ、生き残ったものを報告する。構文として読めない変異は数に入れない。毎回ソースを元に戻して読み直し、戻っていなければ印をツリーに残して 0 以外で終わる。180 秒を超えた走行は止め、その変異を HUNG と報告する。止めるのは掃引が起動したコマンドで、そのコマンドが起動したものは止めないので、自分でプロセスを起動するテストは `bail.mjs` を通して走らせる。環境変数での指定:
  - `MUTATE_LINES=<first>-<last>`: 場所がその行の範囲にある変異だけ。対照はファイル全体で走る。
  - `MUTATE_SHARD=<k>/<n>`: その中の k 番目から n 個おき。n 個のツリーで n 本の掃引が分け合い、それぞれが自分の対照と基準を走らせる。
  - `MUTATE_COUNT=1`: 何回走らせることになるかだけを数える。何も書かず、何も走らせない。
  - `MUTATE_CONFIRM=<shell line>`: 生き残りだけに走らせる 2 本目のテスト。
  - `MUTATE_OPTIONAL=1`: optional chaining の規則も加える。
  - `MUTATE_TIMEOUT_MS=<n>`: 1 回の走行の上限を 180 秒から n ミリ秒にする。
- `sweep.mjs --verify [<tree>]`: 何も書かず、テストも走らせない。`equivalents.md` の各項目が、今のコードにある変異をまだ指しているかを確かめる。
- `bail.mjs <pattern> <test command…>`: テストを専用のプロセスグループで走らせ、パターンに合う行が最初に出たところで exit 1 で終える。テストが落とす変異は、最初の失敗までの時間で済む。このときはグループごと止め、テスト自身の後始末は走らない。走行に届いたシグナル (Ctrl-C・掃引の時間切れ) はグループへ渡し、テストが終わったらグループの残りを止め、そのシグナルで終わる。合う行が無ければテストの終わり方のまま終わり、テストが起動して残したものは止めない。失敗として止めた走行は、テストもそのまま失敗で終えたはずのものだが、その行を出した後にテストが 0 で終わるか終わらないはずだった場合は別で、掃引は `bail.mjs` 無しでは生き残り、有りでは落ちたと数える。プロセスグループの無い Windows では走らない (exit 2)。
- `sweep-all.sh <tree> <report> <suite command> <file>…`: ファイルを 1 つずつ掃引して 1 つの報告にまとめる。途中で止まった掃引があれば、空の節を残さずに全体を止める。

<a id="coverage"></a>
## カバレッジの報告: `tools/coverage/v8-to-lcov.mjs`

`v8-to-lcov.mjs <coverage dir> <lcov out> <source>…` は、`NODE_V8_COVERAGE` に V8 が残したカバレッジを、指定したソースの lcov の報告にする。ソースは、それを読み込んだ文脈を問わず、それから作られたすべてのスクリプトから数える (`file:` の URL は自分のパスを指すもの、それ以外の URL は名前で終わるもの)。本文の長さがソースと違うスクリプトからは数えない。行の中のどこかが走れば走った行とし、走っていない部分があれば通らなかった分岐として報告する。空行とコメントだけの行は報告しない。どこからも読み込まれなかったソースは、全行を走っていないものとして報告する。共通の `ci.yaml` は、`pack.py --list` が梱包する JS ファイルのうち `core/` と `audio-worklet.js` 以外を指定する (この 2 つはこのリポジトリのテストが受け持つ)。

<a id="package"></a>
## パッケージとアイコン: `pack.py`・`gen_icons.py`

- `pack.py`: 拡張が読み込むものから Chrome ウェブストア用の zip を作る。manifest、manifest が指すもの、それらのページと worker が読み込むもの、locale のファイル。どこからも参照されないファイルは入れないが、`LICENSE` は必ず入れ、無ければ止まる。`--list` は選んだファイルを表示するだけで zip を書かない。`_locales/` の中はすべて、Chrome ウェブストアが公開する locale の一覧の名前 (その綴りのまま) のフォルダに、それぞれの `messages.json` と一緒に置く。どのエントリも同じ時刻・同じモード・同じホストで書くので、同じファイルからはどのマシンでも同じ zip ができる。zip の名前は `core.json` の `package` から付ける。
- `gen_icons.py`: `core.json` の `icon` が指定する色と文字で、アイコン (16・48・128 px) を描く。pillow が要り、無ければ exit 3。

<a id="check-shared"></a>
## 写しの照合: `tools/check-shared.sh`

`core.json` が固定するこのリポジトリのコミットを取ってきて、そのコミットの `sync.mjs --check` を走らせる。違う・無い・実行ビットが変わった共通ファイルの名前を挙げて exit 1 で終わる。取得先のリポジトリはツリーから読まずスクリプトに書いてあり、`CORE_SOURCE` で別の取得先を指定できる。

<a id="release"></a>
## リリース: `release` グループ

- `tag-release.yaml`: `main` への push で CI が通ると走る。そのコミットが `manifest.json` の版 (`version_name` があればそれ、無ければ `version`) を最初の親から動かしていれば、`tools/tag-plan.sh` がタグ `v<version>` を決め (push の前に、タグを `tools/check-tag.sh` に、manifest を `tools/verify-version.sh` に確かめさせる)、push し、そのタグで `release.yaml` を起動する。版上げのマージがそのままリリースになる。同じ名前のタグが別のコミットにあればジョブは失敗し、タグは動かさない。
- `release.yaml`: リリースのタグで走る。`tools/check-tag.sh` はこのワークフローがリリースを作らない名前のタグ (`vN.N.N`、またはそれに `-beta` / `-rc` / `-alpha` を付けたもの以外) を断り、ブランチでの走行はリリースを作らない。テストを走らせ、`tools/verify-version.sh` でタグと manifest の版 (`version_name` があればそれで、`version` か `version` の後に `-` が続くものでなければならない。無ければ `version`) を照らし、パッケージを作って GitHub の下書きの Release に付ける。

<a id="workflows"></a>
## ほかのワークフロー

- `ci.yaml`: `main` への push・`main` への PR・手動で走る。Python の構文の確認、写しの照合、拡張のテスト (あれば `test.js`・`test-navigation.js`・`test-screenshots.py`)、あればスクリーンショットの照合、Codecov へのカバレッジの報告。
- `sync-core.yaml`: このリポジトリの `main` を取り込む毎日の PR ([README](../README.ja.md))。
- `dependabot-auto-merge.yml` とそのテスト: Dependabot だけが書いたパッチ・マイナーの更新を自動でマージする。
- `.gitattributes`: 共通ファイルをすべて LF の改行で取り出す。
