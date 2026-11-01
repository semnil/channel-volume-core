# 共通ファイル

[English](shared-files.md)

`shared/` の各ファイルが拡張の中で何をするか。各拡張の文書は、その拡張がこれらのファイルに何を渡しどう使うかを書き、それ以外はここを指す。拡張がどのファイルを受け取るか、変更がどう届くかは [README](../README.ja.md) にある。

<a id="shared-code"></a>
## 共通コード: `core/common.js`

各拡張が自分のスクリプトより先に読み込むクラシックスクリプト。拡張の `utils.js` を読み込む場所 (popup・設定ページ・content script・service worker) ではどこでも先に読み込まれ、トップレベルの宣言はそこでのグローバルになる。拡張ごとに違うもの (ストレージの領域とキー、メッセージの型、書き込みの表、ページの要素) は呼び出し側が渡す。

<a id="settings"></a>
### 設定

- `SETTINGS_KEY`・`DEFAULT_TARGET_LUFS`・`MIN_TARGET_LUFS` / `MAX_TARGET_LUFS` (-30, -6): 設定オブジェクトを置くキー、Target LUFS の既定値とその範囲。
- `readSettings`・`isStoredSettingsObject`: sync の設定オブジェクト。sync に無い間は local の写し、local が空で返ったときはもう一度 sync、どちらにも設定オブジェクトが無ければ `{}`。
- `moveSettingsToSync`: 以前の版が local に置いた設定を、sync に無いときだけ sync へ移し、local から消す。local が空になってから答え、失敗は失敗として答える。
- `createSerialQueue`: 処理を 1 つずつ順に走らせる。失敗しても次へ進み、それぞれが終わった時点で答える。
- `writeSettingsChange`・`sameStoredSettings`・`settingCheck`: 読んだ設定への変更を sync へ書く。読んだ値と sync がすでにそれを持っていれば書かない。表に載った項目の検査を返し、載っていない名前には何も返さない。

<a id="stored-map"></a>
### 持ち主の一覧とその行

- `createStoredMapWriter`: `storage.local` の一覧 (拡張の持ち主とそのゲイン) を、変わったときだけ書き戻す。専用の列で 1 回ずつ書き、実行環境に届かないときは何も書かない。
- `MIN_GAIN` / `MAX_GAIN` (0, 6)・`clampGain`・`isStorableGain`: ゲインの範囲と、書き込みが保存してよいゲイン (その範囲の有限の数)。
- `storedGain`・`expandLegacyGain`・`hasTypedGain`: 行の種類ごとのゲイン。以前の単一のゲインは、種類ごとの項目がどれもキーに無いときだけ、有限の数であるときだけ読み、書き込みのときに写す。
- `applyEntryName`: id ではない自分の名前があれば行の名前をそれに替える。名前の無い行は、呼び出し側が求めたときに id を名前にする。
- `expandLegacyAutoFlag`・`autoFlagFor`: 以前の全種類共通の Auto のフラグは、自分のフラグを持たない種類だけを埋める。種類の Auto の状態は、自分のフラグ、以前のフラグ、保存ゲインの規則、既定値の順に決まる。
- `isRowKey`・`rowLabel`: 削除が指してよいキー (空でない文字列)。行を表示し並べる名前 (空でない文字列の名前があればそれ、無ければキー)。

<a id="writes"></a>
### ほかの場所に頼まれて worker が行う書き込み

- `createWriteListener`: ほかの場所が頼む書き込みを受ける service worker のメッセージの受け手。書き込みの表はメッセージの型ごとに呼び出し側が渡す。断り (`WriteRefused`) は `invalid-mutation` で、保存の失敗はその書き込み自身の理由で答える。どの書き込みも指さないメッセージには答えず、呼び出し側が無視する型でなければ記録する。
- `tableWrite`: 呼び出し側の接頭辞の後ろの名前が指す、表の書き込み。
- `requestWrite`: ページやタブからの書き込みの依頼。書き込みが済めば worker の答えで解決し、そうでなければ答えた理由 (理由が無ければ `write not confirmed`) で拒否する。

<a id="gain"></a>
### ゲイン

- `isContextValid`: 拡張の実行環境にまだ届くかどうか。
- `gainToPercent`・`percentToGain`・`gainToDb`・`formatGain`・`formatGainText`・`formatAutoGain`: ゲインを % や dB にしたり戻したりする。表示単位での数と単位、1 つの文字列、Auto での見せ方 (保存ゲインが無ければ `Auto (—)`)。
- `gainForLevel`: レベルを目標へ合わせるゲイン。`10^((目標 - レベル) / 20)` をゲインの範囲に収め、有限でなければ 1。
- `AUTO_FOLLOW_INTERVAL_MS` (1000 ms): 再生中に動くレベルから Auto がゲインを決め直す最短の間隔。

<a id="pages"></a>
### ページ

- `msg`・`applyI18n`・`esc`: カタログの文言 (無ければキーそのもの)。`data-i18n` を持つ要素をそれぞれの文言で埋め、`<html lang>` を `pageLanguage` から決める。文字列をタグの間と引用符で囲んだ属性の中で安全にする。
- `revealPage`: 書いた内容をレイアウトさせてから、次のフレームで `body.initializing` を外す。
- `runPageLoad`・`PAGE_LOAD_TIMEOUT_MS` (3 秒): ページの最初の読み込み。拒否されたときと期限までに終わらなかったときは失敗とし、答えが出たらページを見せる。

<a id="sliders"></a>
### スライダーの操作

- `SLIDER_VALUE_KEYS`・`isSliderMoveKey`・`createSliderKeys`: range の値を動かすキー (キーの押し続けになるのはこれだけ) と、1 つのスライダーで押されているそれらのキーの記録。
- `holdSettingsSlider`: 設定ページのスライダーで、キーの押し続け 1 回・ドラッグ 1 回につき書き込みを 1 回にする。キーの押し続けは、値を動かしていれば最後の値のキーの `keyup` で書く。ドラッグは `change` で書く。キーの押し続け中のポインタの押下は、キーの値を `keyup` まで保つ。`blur` で操作は終わり、次の押下まで何も受けない。ブラウザが取り消したドラッグは書かず、保存されている値を描く。
- `holdPopupSlider`・`PREVIEW_KEEP_ALIVE_MS` (1 秒): popup のゲインのスライダーで、キーの押し続け 1 回・ドラッグ 1 回につき保存を 1 回にする。動かしている間はプレビューし、押さえている間は 1 秒ごとに送り直す。操作は、進行中の操作が無いときの入力で始まる。ポインタの押下はキーの押し続けとその値を保つ。ドラッグの `change` より先に来た離しは、そのドラッグと 1 つの操作として扱う。保存は、前回の保存の後に入力があったときだけ行う。`blur` で操作は終わる。取り消されたドラッグは保存せず、描いている値はタブに任せる (呼び出し側の `cancel` に知らせる)。

<a id="settings-page"></a>
### 設定ページ

- `showSettingsError`: `#settingsError` を、カタログの文言で出すか隠す。
- `saveSettingOrRestore`: 操作部品の保存。ページの読み込みが済むまでは何も書かない。書き込みが済めばエラー行を消す。済まなければ、設定が持つ値を読み直して描き (その読み取りの間に設定の変更が来ていれば描かない)、`settingsSaveFailed` を出す。その読み取りも失敗したときは `settingsLoadFailed` を出す。

<a id="popup"></a>
### popup

- `setCardValue`・`setUnknown`: カードの値、`span.unit` の中の単位、カードの class。`---` と、渡した class と `unknown`。
- `STATE_POLL_INTERVAL_MS`・`pollTabState`: 最初の問い合わせはすぐに行い、その後は popup が開いている間、1 秒ごとに状態を聞く。
- `sendTabMessage`: popup から自分のタブへのメッセージ。タブを持たないときは断る。
- `createSaveNotice`: ゲインが保存されていないという知らせ。表示中の持ち主に送った最後の保存の答えが ok でなければ出し、ok の答えか、別の持ち主の表示で消す。
- `drawOwnerName`: 持ち主の名前。無ければカタログの「未検出」の文言を `empty` の class で出す。全文を title に入れる。
- `isSiteTab`: タブの URL のホスト名が、そのサイトかそのサブドメインかどうか。
- `showPopupStatus`・`hidePopupStatus`: 画面の代わりに、カタログの文言で状態の行を出す。画面を戻す。
- `followDisplayUnit`: 表示単位を一度読み、popup が開いている間は sync の変更に合わせる。読み取りの間に来た変更は、読み取りの結果より優先する。
- `bindPresets`: プリセットのボタン。それぞれ自分の % を `data-vol` に持つ。押されると、呼び出し側の `allow` が通す限り、その % をスライダー・スライダーの値・現在値のカードに表示単位で描き、% とそのゲインを呼び出し側の `pick` に渡す。

<a id="mutation"></a>
## 変異テスト: `tools/mutation/`

テストの緑を、緑であること以上のものにする道具。同じ場所の `equivalents.md` は各リポジトリ自身の記録で、共通ではない。

- `sweep.mjs <tree> <source> <test command…>`: ソースから規則で変異を作り、それぞれにテストを走らせ、生き残ったものを報告する。構文として読めない変異は数に入れない。毎回ソースを元に戻して読み直し、戻っていなければ印をツリーに残して 0 以外で終わる。180 秒を超えた走行は止め、その変異を HUNG と報告する。環境変数での指定:
  - `MUTATE_LINES=<first>-<last>`: 場所がその行の範囲にある変異だけ。対照はファイル全体で走る。
  - `MUTATE_SHARD=<k>/<n>`: その中の k 番目から n 個おき。n 個のツリーで n 本の掃引が分け合い、それぞれが自分の対照と基準を走らせる。
  - `MUTATE_COUNT=1`: 何回走らせることになるかだけを数える。何も書かず、何も走らせない。
  - `MUTATE_CONFIRM=<shell line>`: 生き残りだけに走らせる 2 本目のテスト。
  - `MUTATE_OPTIONAL=1`: optional chaining の規則も加える。
  - `MUTATE_TIMEOUT_MS=<n>`: 1 回の走行の上限を 180 秒から n ミリ秒にする。
- `sweep.mjs --verify [<tree>]`: 何も書かず、テストも走らせない。`equivalents.md` の各項目が、今のコードにある変異をまだ指しているかを確かめる。
- `bail.mjs <pattern> <test command…>`: テストを走らせ、パターンに合う行が最初に出たところで exit 1 で終える。テストが落とす変異は、最初の失敗までの時間で済む。合う行が無ければテストの終わり方のまま終わり、シグナルで止まった走行はそのシグナルで終わる。テストは専用のプロセスグループで走り、走行に届いたシグナルはそのグループへ渡し、テストが終わったらグループの残りを止める。テスト自身の後始末は走らない。プロセスグループの無い Windows では走らない (exit 2)。
- `sweep-all.sh <tree> <report> <suite command> <file>…`: ファイルを 1 つずつ掃引して 1 つの報告にまとめる。途中で止まった掃引があれば、空の節を残さずに全体を止める。

<a id="coverage"></a>
## カバレッジの報告: `tools/coverage/v8-to-lcov.mjs`

`v8-to-lcov.mjs <coverage dir> <lcov out> <source>…` は、`NODE_V8_COVERAGE` に V8 が残したカバレッジを、指定したソースの lcov の報告にする。ソースは、それを読み込んだ文脈を問わず、それから作られたすべてのスクリプトから数える (`file:` の URL は自分のパスを指すもの、それ以外の URL は名前で終わるもの)。本文の長さがソースと違うスクリプトからは数えない。行の中のどこかが走れば走った行とし、走っていない部分があれば通らなかった分岐として報告する。空行とコメントだけの行は報告しない。どこからも読み込まれなかったソースは、全行を走っていないものとして報告する。共通の `ci.yaml` は、`pack.py --list` が梱包する JS ファイルのうち `core/` 以外を指定する (`core/` はこのリポジトリのテストが受け持つ)。

<a id="package"></a>
## パッケージとアイコン: `pack.py`・`gen_icons.py`

- `pack.py`: 拡張が読み込むものから Chrome ウェブストア用の zip を作る。manifest、manifest が指すもの、それらのページと worker が読み込むもの、locale のファイル。どこからも参照されないファイルは入れない。`--list` は選んだファイルを表示するだけで zip を書かない。`_locales/` の中はすべて、Chrome ウェブストアが公開する locale の一覧の名前 (その綴りのまま) のフォルダに、それぞれの `messages.json` と一緒に置く。どのエントリも同じ時刻・同じモード・同じホストで書くので、同じファイルからはどのマシンでも同じ zip ができる。zip の名前は `core.json` の `package` から付ける。
- `gen_icons.py`: `core.json` の `icon` が指定する色と文字で、アイコン (16・48・128 px) を描く。pillow が要り、無ければ exit 3。

<a id="check-shared"></a>
## 写しの照合: `tools/check-shared.sh`

`core.json` が固定するこのリポジトリのコミットを取ってきて、そのコミットの `sync.mjs --check` を走らせる。違う・無い・実行ビットが変わった共通ファイルの名前を挙げて exit 1 で終わる。取得先のリポジトリはツリーから読まずスクリプトに書いてあり、`CORE_SOURCE` で別の取得先を指定できる。

<a id="release"></a>
## リリース: `release` グループ

- `tag-release.yaml`: `main` への push で CI が通ると走る。そのコミットが `manifest.json` の版 (`version_name` があればそれ、無ければ `version`) を最初の親から動かしていれば、`tools/tag-plan.sh` がタグ `v<version>` を決めて push し、そのタグで `release.yaml` を起動する。版上げのマージがそのままリリースになる。同じ名前のタグが別のコミットにあればジョブは失敗し、タグは動かさない。
- `release.yaml`: リリースのタグで走る。`tools/check-tag.sh` はこのワークフローがリリースを作らない名前のタグ (`vN.N.N`、またはそれに `-beta` / `-rc` / `-alpha` を付けたもの以外) を断る。テストを走らせ、`tools/verify-version.sh` でタグと manifest を照らし、パッケージを作って GitHub の下書きの Release に付ける。

<a id="workflows"></a>
## ほかのワークフロー

- `ci.yaml`: `main` への push・`main` への PR・手動で走る。Python の構文の確認、写しの照合、拡張のテスト (あれば `test.js`・`test-navigation.js`・`test-screenshots.py`)、あればスクリーンショットの照合、Codecov へのカバレッジの報告。
- `sync-core.yaml`: このリポジトリの `main` を取り込む毎日の PR ([README](../README.ja.md))。
- `dependabot-auto-merge.yml` とそのテスト: Dependabot だけが書いたパッチ・マイナーの更新を自動でマージする。
- `.gitattributes`: 共通ファイルをすべて LF の改行で取り出す。
