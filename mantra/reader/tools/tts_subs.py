#!/usr/bin/env python3
"""朗讀讀音表（books/<id>.tts.json）的決定式產生器，也放「問句句尾『不』讀 ㄈㄡˇ」這條注音規則。
建書工具（/workspace/sutra3/build_books.py、html2book.py、sutra2book.py）在產生注音的同一步呼叫這裡，所以新經一建好就有朗讀表。

規則（River 2026-11-20）：
  1. 書裡每一個「破音字」（教育部注音表 ∪ pypinyin 多音，有兩個以上讀音；或注音不是它的任何已知讀音）出現的地方，
     朗讀時一律換成「只有一個讀音、而且就是注音那個讀音」的常用同音字，不再預測語音會不會唸錯。只有一個讀音的字照原字唸。
  2. 例外（照原字唸）：
     - 「一」、「不」(ㄅㄨˋ)：變調（不是 bú shì、一切 yí qiè）要交給語音，換字會唸錯調。
     - 輕聲（˙）注音：不強制。
     - 找不到單一讀音同音字、而且注音就是這個字平常單唸的讀音（例如 佛 ㄈㄛˊ）：換成拼音反而風險較大，照原字唸。
     - 這個字實際上只有一個讀音（dominant()），只找得到很罕用的同音字（頻率不到 1/50）：換了反而怪，照原字唸。
  3. 找不到同音字、而且注音不是平常讀音的（或舊的詞語預測器認為這本經裡會唸錯，如「更生」的更）：用數字調拼音（如 nan4），tts.js 只在 Google 語音時送拼音，其他語音照原字唸。
  4. PINNED：River 實際聽過、指定的換法，優先於自動挑選（不 ㄈㄡˇ→否、幢→床、淺→遣、得→德）。
  5. 問句句尾「不」：「不」後面緊接「？」時讀 ㄈㄡˇ（同「否」），apply_fou() 在產生注音時套用。"""
import collections, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zhuyin_pinyin import zhuyin_token_to_pinyin
from pypinyin import pinyin, Style
from pypinyin.contrib.tone_convert import to_tone3
import opencc

T2S = opencc.OpenCC('t2s')
DEF_BPMF = '/workspace/share/next10/preview_sutra_font/shared/bpmf/bpmf.json'
FOU = 'ㄈㄡˇ'

PINNED = {  # (char, 注音) -> spoken char; heard/decided by River, wins over the automatic choice
    ('不', 'ㄈㄡˇ'): '否',   # 問句句尾「不」= 否（River 2026-11-20）
    ('幢', 'ㄔㄨㄤˊ'): '床',  # River 聽到唸成 zhuàng（撞）
    ('淺', 'ㄑㄧㄢˇ'): '遣',  # River 聽到「即得淺處」唸成 jiān
    ('得', 'ㄉㄜˊ'): '德',    # Google 把「皆得解脫」的得唸成 děi
}
SANDHI_KEEP = {('一', None), ('不', 'ㄅㄨˋ')}   # tone sandhi left to the voice


def apply_fou(text, zys):
    """問句句尾「不」：「不」後面緊接「？」→ 注音 ㄈㄡˇ。zys: list of 注音 tokens, same length as text. Returns changed indices."""
    ch = list(text); out = []
    for i, c in enumerate(ch):
        if c == '不' and i + 1 < len(ch) and ch[i + 1] == '？' and zys[i] != FOU:
            zys[i] = FOU; out.append(i)
    return out


def zy2py(z):
    if not z or z == '-':
        return None
    try:
        return zhuyin_token_to_pinyin(z, numbered=True)
    except ValueError:
        return None


def tone3(x):
    return to_tone3(x, neutral_tone_with_five=True).replace('ü', 'v')


class Readings:
    def __init__(self, bpmf=None):
        self.bpmf = bpmf if bpmf is not None else json.load(open(DEF_BPMF, encoding='utf-8'))
        self._pool = None

    def moe(self, c):
        return {x for x in (zy2py(z) for z in self.bpmf.get(c, [])) if x and not x.endswith('5')}

    def pyp(self, c):
        return {x for x in (tone3(p) for p in pinyin(c, heteronym=True, style=Style.TONE)[0]) if x and not x.endswith('5') and x[-1].isdigit()}

    def all(self, c):
        return self.moe(c) | self.pyp(c)

    def default(self, c):
        """the reading a voice most likely gives the char on its own (Taiwan dictionary first, then pypinyin's default)"""
        m = self.moe(c)
        d = tone3(pinyin(c, style=Style.TONE, heteronym=False)[0][0])
        if len(m) == 1: return next(iter(m))
        return d if (not m or d in m) else sorted(m)[0]

    def _stats(self):
        if not hasattr(self, '_pc'):
            import jieba
            from pypinyin.constants import PHRASES_DICT
            self._freq = collections.Counter()
            for line in open(os.path.join(os.path.dirname(jieba.__file__), 'dict.txt'), encoding='utf-8'):
                p = line.split()
                if len(p) >= 2:
                    for c in p[0]: self._freq[c] += int(p[1])
            self._pc = collections.defaultdict(collections.Counter)
            for w, ps in PHRASES_DICT.items():
                if len(w) == len(ps):
                    for ch, x in zip(w, ps): self._pc[ch][tone3(x[0])] += 1
            try:
                from gen_tts import TW_SINGLE
            except Exception:
                TW_SINGLE = {}
            self._tw = TW_SINGLE
        return self._pc, self._freq

    def dominant(self, c):
        """-> (reading, practically_one_reading).  The reading a voice gives the char in almost every word: Taiwan
        override (gen_tts.TW_SINGLE) or pypinyin's default; 'one reading' = other readings occur in at most 2 phrases of
        pypinyin's phrase dictionary and in < 3 % of them, never as neutral tone, and the 教育部 table has that reading."""
        pc, _ = self._stats()
        sc = T2S.convert(c) if len(T2S.convert(c)) == 1 else c
        d = tone3(pinyin(sc, style=Style.TONE, heteronym=False)[0][0])
        if c in self._tw and self._tw[c] != d:
            return self._tw[c], False                     # Taiwan default differs from the mainland one
        cnt = pc.get(sc, collections.Counter()); tot = sum(cnt.values()); other = tot - cnt.get(d, 0)
        m = self.moe(c)
        one = (other <= 2 and other < 0.03 * max(tot, 1) and not any(k.endswith('5') for k in cnt) and (not m or d in m)
               and (tot > 0 or self.pyp(c) <= {d}))
        return d, one

    def pool(self):
        """target pinyin -> [(tier, -freq, char)]: common chars (Big5 常用字, jieba frequency >= 200; chars >= 1000 come first) that in practice have
        one reading = target.  tier 1 = one reading in both 教育部注音表 and pypinyin; tier 2 = dominant() says one reading
        (the 教育部 table also lists rare/old readings).  Tier 1 is preferred when its best char is >= 1/10 as frequent."""
        if self._pool is None:
            _, freq = self._stats()
            pool = collections.defaultdict(list)
            for c in self.bpmf:
                if len(c) != 1: continue
                try: b = int.from_bytes(c.encode('big5'), 'big')
                except Exception: continue
                if not (0xA440 <= b <= 0xC67E): continue
                f = freq.get(T2S.convert(c), 0)
                if f < 200: continue
                m, p = self.moe(c), self.pyp(c)
                d, one = self.dominant(c)
                if d.endswith('5'): continue
                pd = tone3(pinyin(c, style=Style.TONE, heteronym=False)[0][0])
                if m == {d} and p <= {d}: tier = 1                # one reading in both tables
                elif m == {d} and (one or pd == d): tier = 2      # 教育部 one reading; pypinyin lists rare extra ones
                elif p == {d} and one and d in m: tier = 2        # pypinyin one reading; 教育部 lists a rare/old extra one
                else: continue
                t = d
                pool[t].append((tier, -f, c))
            for t in pool:
                L = sorted(pool[t], key=lambda x: x[1])
                common = [x for x in L if -x[1] >= 1000]; rare = [x for x in L if -x[1] < 1000]
                t1 = [x for x in common if x[0] == 1 and -x[1] * 10 >= -common[0][1]] if common else []
                pool[t] = t1 + [x for x in common if x not in t1] + rare
            self._pool = pool
        return self._pool

    def homophone(self, t, avoid=()):
        """best one-reading homophone for pinyin t; a hand-picked gen_tts.PREFERRED char wins if it qualifies"""
        L = [x for x in self.pool().get(t, []) if x[2] not in avoid]
        try:
            from gen_tts import PREFERRED
        except Exception:
            PREFERRED = {}
        pref = PREFERRED.get(t)
        for x in L:
            if x[2] == pref: return x[2], x[0]
        if L: return L[0][2], L[0][0]
        if pref and pref not in avoid: return pref, 3             # tier 3: hand-picked, not strictly one reading
        if not hasattr(self, '_rare'):                             # tier 4: any Big5 常用字 with one reading in both tables
            _, freq = self._stats(); self._rare = collections.defaultdict(list)
            for c in self.bpmf:
                if len(c) != 1: continue
                try: b = int.from_bytes(c.encode('big5'), 'big')
                except Exception: continue
                if not (0xA440 <= b <= 0xC67E): continue
                m = self.moe(c)
                if len(m) == 1 and self.pyp(c) <= m:
                    t_ = next(iter(m))
                    if not t_.endswith('5'): self._rare[t_].append((-freq.get(T2S.convert(c), 0), c))
            for k in self._rare: self._rare[k].sort()
        for f, c in self._rare.get(t, []):
            if c not in avoid: return c, 4
        return None, None


def lines_of(book):
    for bl in book['blocks']:
        for ln in bl.get('lines', []):
            yield ln[0], ln[1].split()


def build(book, R=None):
    """-> (subs, stats).  One sub per (char, 注音) that needs one; tts.js applies it wherever that char has that 注音."""
    R = R or Readings()
    occ, ctx = collections.Counter(), collections.defaultdict(list)
    for text, zs in lines_of(book):
        ch = list(text)
        if len(ch) != len(zs):
            print('warn: zy count mismatch', book.get('id'), text[:20], file=sys.stderr); continue
        for i, (c, z) in enumerate(zip(ch, zs)):
            if z == '-' or zy2py(z) is None: continue
            occ[(c, z)] += 1
            if len(ctx[(c, z)]) < 3:
                cx = text[max(0, i - 2):i + 3]
                if cx not in ctx[(c, z)]: ctx[(c, z)].append(cx)
    # where a char is kept as written (no one-reading homophone), the old word-level predictor (gen_tts.Predictor) is
    # asked whether a voice would misread it in this book; if so the numbered pinyin is sent instead (e.g. 更生 gēng)
    misread = collections.Counter()
    try:
        import gen_tts
        P = gen_tts.Predictor(R.bpmf)
        for run in gen_tts.runs_of(book):
            p = P.predict(''.join(c for c, _ in run))
            for i, (c, z) in enumerate(run):
                if not gen_tts.same(zy2py(z), p[i][0], c): misread[(c, z)] += 1
    except Exception as e:
        print('warn: predictor unavailable:', e, file=sys.stderr)
    subs, st = [], collections.defaultdict(list)
    for (c, z), n in occ.items():
        t = zy2py(z)
        if (c, z) in PINNED:
            subs.append(dict(frm=c, to=PINNED[(c, z)], zy=z, n=n, kind='pinned')); st['pinned'].append((c, z, PINNED[(c, z)], n)); continue
        if c == '一' or (c, z) in SANDHI_KEEP:
            st['keep_sandhi'].append((c, z, n)); continue
        if t.endswith('5'):
            st['keep_neutral'].append((c, z, n)); continue
        d, one = R.dominant(c)
        if R.moe(c) == {t} and one and d == t:
            continue                                                     # one reading, and it is the annotated one
        h, tier = R.homophone(t, avoid={c})
        _, freq = R._stats()
        if h and one and d == t and freq.get(T2S.convert(h), 0) * 50 < freq.get(T2S.convert(c), 0):
            st['keep_rare_homophone'].append((c, z, h, n)); continue     # only a rare homophone: swapping is worse
        if h:
            subs.append(dict(frm=c, to=h, zy=z, n=n, kind='homophone%d' % tier)); st['homophone%d' % tier].append((c, z, h, n))
        elif d == t and not misread.get((c, z)):
            st['keep_nohomophone'].append((c, z, n, '／'.join(ctx[(c, z)])))
        else:
            subs.append(dict(frm=c, to=' %s ' % t, zy=z, n=n, kind='pinyin')); st['pinyin'].append((c, z, t, n, '／'.join(ctx[(c, z)])))
    subs.sort(key=lambda s: (-s['n'], s['frm']))
    return subs, st


def tts_doc(book, subs):
    return {'book': book['id'], 'generated_by': 'tools/tts_subs.py',
            'note': 'TTS-only substitutions for 朗讀; display text is unchanged. A sub applies where the text equals from AND its 注音 equals zy. '
                    'Every polyphonic char is replaced by a one-reading homophone of its 注音 (see TTS-NOTES.md).',
            'subs': [{'from': s['frm'], 'to': s['to'], 'zy': s['zy'], 'count': s['n'], 'kind': s['kind']} for s in subs]}


def write_tts(book, books_dir, R=None):
    subs, st = build(book, R)
    path = os.path.join(books_dir, book['id'] + '.tts.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(tts_doc(book, subs), f, ensure_ascii=False, indent=1); f.write('\n')
    return path, subs, st
