# 怎麼加一頁單字

單字不寫在 `index.html` 裡。整本書的目錄在 `data/manifest.js`，每一頁是一支小的 JavaScript。頁面用 `<script>` 標籤載入這些檔案，不用 `fetch()`，所以用檔案總管直接打開 `index.html`（`file://`）也能離線看。

列表會在某一頁捲到附近，或點那一頁的標題時，才載入那一頁。按「Play All」和打開「SRS 練習」會先把所有頁載完。

## 一筆單字有哪些欄位

`window.VOCAB_REGISTER` 裡的每一筆都要有這些欄位，文字跟畫面上看到的一樣：

| 欄位 | 說明 |
| --- | --- |
| `num` | 編號 |
| `word` | 英文單字。SRS 進度存在 `localStorage` 的 `vocabSRS_v1`，就是用這個字當鍵。已經上線的單字不要改 `word`，不然舊進度會對不到。程式不會清掉舊進度。朗讀也是讀這個字，不是下面的分音。 |
| `syllables` | 選填。三個音節以上才填，例如 `["beau","ti","ful"]`。用美式辭典（Merriam-Webster）的移行分法，不要用自動斷字程式。一兩個音節、或自己不確定，就不要填。 |
| `stress` | 選填。重音在 `syllables` 的第幾個（從 0 開始）。重音照這一筆的音標（ˈ 是主重音）。 |
| `tags` | 標籤陣列，例如 `letter:B`、`page:6`、`suffix:-ful（…）`、`root:care（…）`、`comparison:more/most`。`book:` 和 `unit:` 會存著，但畫面上不顯示。 |
| `phonetics` | 音標，連方括號一起寫 |
| `chinese_meaning` | 卡片上的中文解釋 |
| `comparative` | 比較級；沒有就寫 `null` |
| `superlative` | 最高級；沒有就寫 `null` |
| `phrase` | 片語；沒有就寫 `""` |
| `collocations` | 選填。例句裡的搭配，陣列。每一項是 `{ text, kind, zh, match }`。`kind` 是 `prep`（介系詞）或 `phrase`（片語）。`text` 是卡片上的寫法，`zh` 是點芯片時顯示的中文。`match` 是這句例句裡實際出現的字（大小寫不拘）；分開的兩段（例如 so … that）就寫成陣列。例句平常只標單字本身；點卡片上的 🔗 芯片才把該搭配標出來。篩選列的「搭配詞」只收介系詞，一顆芯片一個介系詞（例如 `+in`、`+about`），片語不進篩選列。 |
| `example_sentence` | 卡片上的例句 |
| `example_translation` | 卡片上的中譯 |
| `page` | 頁碼 |
| `speak_meaning` | 朗讀中文解釋用的文字（`zh-TW`，沒有這個語音就改用 `zh-CN`） |
| `speak_sentence` | 朗讀例句用的英文 |
| `speak_translation` | 朗讀中譯用的文字 |

## 新增一頁

1. 新增資料檔，路徑只用英數，例如 `data/tango2000/p8.js`。
2. 檔案裡呼叫（第一個名字要和清單裡的 `id` 一樣）：

```js
window.VOCAB_REGISTER('tango2000-p8', [
  {
    num: 34,
    word: 'kind',
    phonetics: '[kaɪnd]',
    chinese_meaning: '形 親切的',
    comparative: 'kinder',
    superlative: 'kindest',
    phrase: '',
    example_sentence: 'She is kind to everyone.',
    example_translation: '她對每個人都很親切。',
    page: 8,
    speak_meaning: '親切的',
    speak_sentence: 'She is kind to everyone.',
    speak_translation: '她對每個人都很親切。'
  }
]);
```

3. 在 `data/manifest.js` 那個單元的 `chunks` 加一行：

```js
{ id: 'tango2000-p8', label: '第8頁', file: 'data/tango2000/p8.js', count: 1 }
```

`count` 要等於陣列的長度。`file` 是從 `index.html` 看過去的路徑。

4. 在 `vocabulary` 資料夾執行：

```sh
node tools/build-index.mjs
```

這會重寫 `data/sentence-index.js`（例句互相出現的索引），然後用內容雜湊把目錄、索引和每一頁複製成帶雜湊的檔名（例如 `manifest.<hash>.js`、`tango2000/p6.<hash>.js`），並把 `index.html` 的 `VOCAB_VERSION` 指到這次的雜湊。`index.html` 自己的檔名不變。頁面只載入這些新檔名，所以手機上的舊快取不會再套用。沒改過的頁面雜湊不變，還是可以沿用快取。

你改的是不帶雜湊的原始檔（`manifest.js`、`p6.js` 這種）。帶雜湊的檔是發佈用的，不要手改。若載入的目錄單元數少於 `VOCAB_EXPECT_UNITS`，頁面會再用一個新的 query 重抓一次目錄。

這樣就好，不用再手改 `index.html` 裡的路徑。

## 例句挖空

SRS 裡每張單字卡之外，還有一張挖空卡，鍵是 `cloze:` 加單字（例如 `cloze:interested`），排程跟單字卡分開，同一套 Again / Hard / Good / Easy。單字卡要練到 repetitions ≥ 2，或間隔 ≥ 3 天，挖空卡才會出現。開關是「例句挖空練習」（`vocabSrsCloze`，預設開）。題型是「自動 / 選擇題 / 填空」（`vocabSrsClozeMode`，預設自動）。統計分兩列：「單字卡」和「例句挖空」。挖空的新卡只算已解鎖、還沒評過分的；還沒解鎖的寫在「未解鎖 N」。關掉挖空練習時，那一列會變淡並標「已關閉」。

自動：挖空卡間隔小於 7 天是選擇題（有搭配詞就挖介系詞或片語關鍵字；沒有就挖單字本身），7 天以上改填空（搭配詞連同單字一起挖），21 天以上只給中文、自己對整句。挖空卡不算進每日新單字，但每天最多新開 10 張挖空。單字卡仍排在挖空卡前面。

選擇題和填空：挖空卡間隔小於 7 天時，中文提示直接出現在例句下面（搭配詞是例句翻譯；一般單字再加上字義）。間隔 7 天以上先藏起來，按「💡 看提示」才顯示。作答前看過提示的話，自動評分最高只到 Good（Easy 改成 Good，Hard 和 Again 不變），按鈕旁會標「已看提示」。揭曉答案時提示一定看得到。整句本來就給中文，不受這條影響。

「自動評分」（`vocabSrsAutoGrade`，預設開）只套在選擇題和填空，不套整句，也不套一般翻卡。從題目出現到第一次作答計時：答錯，或選擇題先選錯再選對、填空答錯後再改對，都記 Again。答對但超過 8 秒是 Hard，3–8 秒是 Good，3 秒內是 Easy。填空會按答案長度放寬（超過 4 個字，每個字大約再加 0.5 秒）。評分先亮在按鈕上約 1.5 秒，可改按別的；若有朗讀整句，等朗讀結束才開始倒數。關掉就只提示建議，不自動送出。

## 新增一課或一本書

- 新的一課：在同一本書的 `units` 再加一個物件，裡面有自己的 `id`、`title` 和 `chunks`。
- 新的一本書：在 `books` 再加一個物件，`id` 用英數（也當作資料夾名稱），`title` 是畫面上的書名。

書、課、檔案的路徑都用英數，不要用中文檔名。
