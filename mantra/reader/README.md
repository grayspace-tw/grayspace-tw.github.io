# 注音經文 reader（資料驅動共用版型）

一個固定的閱讀頁（`index.html` + `reader.css` + `reader.js`）在瀏覽器端讀 `books/` 下的經文資料檔，當場排版分頁。
**新增經書只要放一份資料檔＋在目錄加一行，不用產生或建置任何 HTML。**

- 目錄：`index.html`（無參數）列出 `books/index.json` 的所有經書
- 選書：`index.html?book=<id>`，例如 `?book=dashizhi`、`?book=pumenpin`
- 切換：工具列與目錄頁頂端都有「咒語練習｜經文閱讀」切換，咒語練習 → `../`（/mantra/）；咒語練習頁頁首有同一個切換（經文閱讀 → `./reader/`），其 ☰ 選單「經文」也直接連到 `./reader/?book=<id>`。舊的 /mantra/dashizhi/、/mantra/qiqingwen/ 由本閱讀頁取代。
- 字型：全字庫正楷體，路徑 `../../fonts/cns11643/`（與咒語練習頁 /mantra/ 共用同一份字型，放在 `/mantra/reader/` 時不需另外下載）。缺字型時退回系統楷體。

## 版面
- 直書，由右到左；一字一格：漢字＋右側直排注音（與網站現有經文注音頁同一套格線尺寸 `--cw/--ch/--zs`）。
- 以「目前可視的畫面」分頁：一頁（寬螢幕為左右兩頁，右頁是前一頁）剛好一個畫面高；**一句（到 ，。、；：！？」』 為止）不拆到兩頁**，放不下就換頁；偈頌一行為一句，每行從新的一直行開始；段落從新的一直行開始，`section` 從新的一頁開始。
- 頁與頁之間有間隔（虛線＋頁碼）；scroll-snap 一頁一頁停。
- 每頁：細黑雙線外框＋四角捲草角花（自繪 SVG：角落一顆愛心形捲草、內有捲渦，雙線輪廓，兩臂沿邊延伸收成捲渦；畫左上角，其餘三角以 scale(-1,1)／(1,-1)／(-1,-1) 鏡像，每角朝自己的外角，外框線在角花處斷開）、頁外側邊欄直寫短經名與中文頁碼（一、二、三…）、第一頁有大字經名與譯者小字。
- 翻頁：‹ 上一頁／下一頁 ›、← ↓ PageDown 空白鍵＝下一頁，→ ↑ PageUp Shift+空白鍵＝上一頁，Home／End。
- 全螢幕：Fullscreen API（含 webkit 前綴）；iPhone Safari 不支援元素全螢幕，改為沉浸模式（隱藏上下工具列，只留頁面與「✕ 離開全螢幕」）。Esc 離開。
- 視窗大小改變、手機旋轉、A−／A＋ 都會重新分頁，並停在原來讀到的地方。字級分寬螢幕／手機各記一份（localStorage）。

## 資料格式

`books/index.json`
```json
{"books": [
  {"id": "dashizhi", "title": "大勢至菩薩念佛圓通章", "note": "目錄頁上的小字（可省略）"},
  {"id": "pumenpin", "title": "妙法蓮華經觀世音菩薩普門品", "note": "姚秦 鳩摩羅什 譯", "file": "pumenpin.json"}
]}
```
`file` 可省略（預設 `<id>.json`）。

`books/<id>.json`
```json
{
 "id": "dashizhi",
 "title": "大勢至菩薩念佛圓通章",        // 第一頁大字經名、瀏覽器標題
 "short": "大勢至圓通章",                // 頁外側邊欄的短經名
 "translator": "唐 般剌蜜帝 譯",          // 第一頁譯者小字（可空字串）
 "scale": 0.78,                          // 可選：這本書的字級倍數（預設 1）
 "from": "《大佛頂…首楞嚴經》卷五",       // 出處（目前只存資料）
 "source": {"cite": "CBETA, T19, no. 945, p. 128a21–b06", "url": "https://cbetaonline.dila.edu.tw/…"},
 "notes": ["讀音說明…"],
 "blocks": [
  {"type": "prose",   "lines": [["大勢至法王子與其同倫…", "ㄉㄚˋ ㄕˋ ㄓˋ ㄈㄚˇ ㄨㄤˊ ㄗˇ ㄩˇ …"]]},
  {"type": "verse",   "lines": [["世尊妙相具，我今重問彼：", "ㄕˋ ㄗㄨㄣ ㄇㄧㄠˋ ㄒㄧㄤˋ ㄐㄩˋ - …"], ["…", "…"]]},
  {"type": "heading", "lines": [["三十五佛懺悔", "ㄙㄢ ㄕˊ ㄨˇ ㄈㄛˊ ㄔㄢˋ ㄏㄨㄟˇ"]]},
  {"type": "section"}
 ]
}
```
（實際檔案是純 JSON，不能有 `//` 註解。）

- 每一行是 `[經文, 注音]`：注音用空白分開，**數量必須等於經文的字數**（以 Unicode 字元計，含標點）；標點、全形空白寫 `-`。輕聲寫 `˙ㄇㄚ`，聲調寫在最後（`ㄉㄚˋ`）。
- `prose`：連續文字，依標點自動斷句；`verse`：偈頌／一行一句（每行另起一直行，整行不跨頁）；`heading`：段標題（另起一直行，用標題色）；`section`：從新的一頁開始。
- 括號、引號會自動換成直排字形（「→﹁ 等）。
- `scale`（可選，別名 `fontScale`，0.4–2，預設 1）：這本書的字級＝預設字級 × scale。A−／A＋ 在這個基礎上加減（調整量依寬螢幕／手機各記一份，所有書共用）。
  例：《諸佛菩薩祈請文》全是佛號，`"scale": 0.78`，讓最長的一行（如「南無大慈大悲千手千眼觀世音菩薩」15 字、含全形空白的 18 格）在桌機與手機都排在同一直行
  （已在 1920×1080、1440×900、1366×768、1280×800、412×915、390×844、375×667、360×740 驗證，沒有一行被拆成兩行）。轉檔：`tools/sutra2book.py qiqingwen --short 祈請文 --translator '' --scale 0.78`。

## 新增一部經
1. 準備 `books/<id>.json`（格式如上）。可用工具：
   - `tools/sutra2book.py <slug> --short 短名 > books/<slug>.json`：從網站經文注音產生器的 `sutra/data/<slug>.json` 轉（讀音與線上頁同一套 bpmf.json + 破音字選擇）。
   - `tools/html2book.py 某注音版.html > books/<id>.json`：從 `<ruby>字<rt>注音</rt></ruby>` 的注音 HTML 轉（普門品就是這樣轉的）。
2. 在 `books/index.json` 的 `books` 加一行 `{"id": "<id>", "title": "…"}`。
3. 朗讀讀音表 `books/<id>.tts.json`：建書工具加 `--tts-dir books`（`--tools mantra/reader/tools`）會在同一步產生；手動做的書用 `python3 tools/gen_tts.py <id> --report report.md`。規則見 `TTS-NOTES.md`（破音字一律換成單一讀音的同音字）。
4. 打開 `index.html?book=<id>` 檢查。完成，不需要建置。

## 朗讀（tts.js）
- 工具列「▶ 朗讀」（500px 以下只顯示 ▶）用瀏覽器的語音合成（speechSynthesis）朗讀，優先選臺灣國語語音（Google 國語（臺灣）、美佳、HsiaoChen／Hanhan…），沒有就用其他國語語音並提示；完全沒有中文語音時顯示說明、不朗讀。
- 唸的是書檔裡的漢字（不是畫面文字），注音只用來決定讀音，不會被唸出來。
- 經文在標點處切成短句，一句一個 utterance 依序唸。暫停＝cancel() 並記住第幾句，繼續時從那句的開頭重唸（精確到句）；不使用瀏覽器內建的 pause()/resume()。
- 從目前這頁的第一句開始（暫停後在同一頁按繼續則從暫停的那句）；唸到哪句就淡色標出那句，換頁時自動翻頁（全螢幕也一樣）。播放中下方有浮動的「暫停／停止／速度（1×、1.25×、0.75×）／語音」。
- 切到背景會自動暫停；離開頁面、換書會停止。iPhone/iPad 必須由點按開始。
- 點字朗讀：點經文裡任一個字，從那句開始唸；唸的時候或暫停中點，就跳到那句。翻頁（捲動、上一頁／下一頁、鍵盤）不受影響，拖曳選字也不會觸發。桌機滑鼠移到字上會有淡色提示。
- 語音選單：浮動控制列最右邊，臺灣國語語音排最前，選過會記住（localStorage `reader.ttsVoice`）。語音清單晚到時會重新挑。怎麼判斷臺灣語音、各平台怎麼加裝臺灣語音：見 `TTS-NOTES.md`。
- 讀音：`tools/tts_subs.py` 把每個破音字換成單一讀音的同音字（River 2026-11-20，規則與例外見 `TTS-NOTES.md`）；River 聽過、指定的換法在 `tts_subs.PINNED`（不 ㄈㄡˇ→否、幢→床、淺→遣、得→德）。破音字總表：`tools/polyphones.py` 產生 `polyphones_review.csv`／`.md`。
- `books/<id>.tts.json`（`tools/tts_subs.py`，由建書工具或 `tools/gen_tts.py` 產生）：`{"subs":[{"from":"給","to":"己","zy":"ㄐㄧˇ"}, …]}`。文字是 `from` 且注音等於 `zy` 的地方，送給語音的字改成 `to`（同音、只有這個讀音的常用字），畫面不變。`to` 若是數字調拼音（找不到同音字時，如 `nan4`），只在 Google 語音時使用。

本機預覽要用 http 伺服器（`fetch` 不能讀 file://），且網站根目錄要有 `fonts/cns11643/`，例如把 reader 放在 `<root>/mantra/reader/`。
