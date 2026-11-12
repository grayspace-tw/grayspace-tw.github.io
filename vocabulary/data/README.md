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
| `collocations` | 選填。例句裡的搭配，陣列。每一項是 `{ text, kind, zh, match }`。`kind` 是 `prep`（介系詞）或 `phrase`（片語）。`text` 是卡片和篩選上的寫法，`zh` 是中文。`match` 是這句例句裡實際出現的字（大小寫不拘）；分開的兩段（例如 so … that）就寫成陣列。同時在 `tags` 加 `colloc:prep:…` 或 `colloc:phrase:…`，篩選列才看得到。 |
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

這會重寫 `data/sentence-index.js`（例句互相出現的索引）。頁面先讀這個小檔；若檔案不在，或某個 chunk id 沒有收進索引，就改回當場掃描已載入的例句。

這樣就好，不用改 `index.html`。

## 新增一課或一本書

- 新的一課：在同一本書的 `units` 再加一個物件，裡面有自己的 `id`、`title` 和 `chunks`。
- 新的一本書：在 `books` 再加一個物件，`id` 用英數（也當作資料夾名稱），`title` 是畫面上的書名。

書、課、檔案的路徑都用英數，不要用中文檔名。
