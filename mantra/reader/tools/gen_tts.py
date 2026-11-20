#!/usr/bin/env python3
"""Offline build step: generate books/<id>.tts.json — TTS-only pronunciation substitutions for the reader's 朗讀.

  python3 tools/gen_tts.py [--books mantra/reader/books] [--bpmf .../bpmf.json] [--report report.md] [ids...]

For every run of annotated characters the script predicts what a browser zh-TW voice would say by default
(word-level: curated TW_WORDS, then pypinyin's phrase dictionary on the t2s-converted text, greedy longest match;
char-level: curated TW_SINGLE, then a reading the 教育部 bpmf table allows) and compares it with the book's 注音.
Where they differ, it emits a substitution  from (original string, 1–4 chars of context) -> to (same-length string
in which the char is replaced by a common homophone that has exactly the annotated reading).  Each substitution is
re-checked with the same predictor and is only kept if every occurrence of `from` in the book carries the same 注音
(the reader also checks `zy` at run time before applying it).  Display text is never changed.

Policy (River): 「一」「不」 are annotated in their base tone and the voice applies 變調 itself, so tone-sandhi
differences are ignored; 不 keeps ㄅㄨˋ (no fǒu override).  Neutral-tone (˙) annotations are not forced.
Needs: pypinyin, opencc, jieba (only for character frequency when choosing homophones)."""
import argparse, glob, json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zhuyin_pinyin import zhuyin_token_to_pinyin
from pypinyin import pinyin, Style
from pypinyin.constants import PHRASES_DICT
import opencc

T2S = opencc.OpenCC('t2s')
HERE = os.path.dirname(os.path.abspath(__file__))
DEF_BPMF = '/workspace/share/next10/preview_sutra_font/shared/bpmf/bpmf.json'

# What a general-purpose zh-TW voice most likely says for these words (it does not know 佛典 readings).
# Keys are traditional; values = numbered pinyin, space separated.  Extend as listening tests find more.
TW_WORDS = {
    '般若': 'ban1 ruo4', '南無': 'nan2 wu2', '阿彌陀': 'a1 mi2 tuo2', '阿耨多羅': 'a1 nou4 duo1 luo2',
    '給孤獨': 'gei3 gu1 du2', '舍衛': 'she4 wei4', '舍利弗': 'she4 li4 fu2', '舍利': 'she4 li4',
    '長老': 'zhang3 lao3', '目乾連': 'mu4 qian2 lian2', '目犍連': 'mu4 jian1 lian2', '佛說': 'fo2 shuo1',
    '尼維多佛': 'ni2 wei2 duo1 fo2', '伽藍': 'qie2 lan2', '僧伽': 'seng1 qie2', '三藐三菩提': 'san1 miao3 san1 pu2 ti2',
    '阿彌陀佛': 'a1 mi2 tuo2 fo2', '轉輪': 'zhuan3 lun2', '觀自在': 'guan1 zi4 zai4', '那由他': 'na4 you2 ta1', '波羅蜜': 'bo1 luo2 mi4', '訶': 'he1',
}
# Known traps (heard or measured): (char, 注音) -> reason.  A substitution is always emitted for these, whatever the
# predictor says, because some voices pick the other reading even where pypinyin/the Google voice get it right.
FORCE = {
    ('淺', 'ㄑㄧㄢˇ'): 'River 聽到「即得淺處」唸成 jiān（淺淺 的讀音）；換成 遣',
    ('處', 'ㄔㄨˋ'): '處 另一讀 chǔ（相處、處理）很常見；Google 在「淺處」唸對 chù，其他語音不一定；換成 觸',
    ('了', 'ㄌㄧㄠˇ'): '「不能解了」可能被唸成 jiě le；換成 ㄌㄧㄠˇ 的同音字',
    ('率', 'ㄕㄨㄞˋ'): '單字預設讀 lǜ（比率）；「相率」要唸 shuài；換成 帥',
    ('得', 'ㄉㄜˊ'): 'Google 國語（臺灣）把「皆得解脫」的 得 唸成 děi（錄音量共振峰 F2≈2600–2900，同「歹/děi」型；「即得」則是 dé）；換成 德',
}
# Single-character default reading of a zh-TW voice (character out of any known word).
TW_SINGLE = {
    '佛': 'fo2', '阿': 'a1', '說': 'shuo1', '樂': 'le4', '行': 'xing2', '長': 'chang2', '重': 'zhong4', '不': 'bu4',
    '一': 'yi1', '為': 'wei2', '解': 'jie3', '給': 'gei3', '乾': 'gan1', '舍': 'she4', '那': 'na4', '若': 'ruo4',
    '般': 'ban1', '無': 'wu2', '南': 'nan2', '和': 'he2', '華': 'hua2', '藏': 'cang2', '數': 'shu4', '調': 'tiao2',
    '得': 'de2', '著': 'zhu4', '識': 'shi4', '相': 'xiang1', '降': 'jiang4', '應': 'ying1', '量': 'liang4',
    '分': 'fen1', '間': 'jian1', '還': 'hai2', '處': 'chu4', '惡': 'e4', '好': 'hao3', '見': 'jian4', '衣': 'yi1',
    '王': 'wang2', '女': 'nv3', '思': 'si1', '施': 'shi1', '度': 'du4', '難': 'nan2', '少': 'shao3', '中': 'zhong1',
    '種': 'zhong3', '當': 'dang1', '強': 'qiang2', '供': 'gong1', '更': 'geng4', '盛': 'sheng4', '藥': 'yao4',
    '陀': 'tuo2', '伽': 'qie2', '迦': 'jia1', '提': 'ti2', '祇': 'qi2', '耨': 'nou4', '薩': 'sa4', '摩': 'mo2',
    '曲': 'qu1', '令': 'ling4', '轉': 'zhuan3', '發': 'fa1', '傳': 'chuan2', '空': 'kong1', '地': 'di4',
    '莫': 'mo4', '於': 'yu2', '縛': 'fu2', '差': 'cha4', '參': 'can1', '朝': 'chao2', '覺': 'jue2', '飲': 'yin3',
    '期': 'qi2', '儲': 'chu2', '攣': 'lvan2', '微': 'wei2', '昔': 'xi2', '食': 'shi2', '奇': 'qi2', '卷': 'juan4', '燕': 'yan4', '厭': 'yan4', '殺': 'sha1', '遺': 'yi2', '畜': 'chu4',
}


def zy2py(z):
    if not z or z == '-':
        return None
    try:
        return zhuyin_token_to_pinyin(z, numbered=True)
    except ValueError:
        return None


def tone3(x):
    from pypinyin.contrib.tone_convert import to_tone3
    t = to_tone3(x, neutral_tone_with_five=True)
    return t.replace('ü', 'v')


class Predictor:
    def __init__(self, bpmf):
        self.bpmf = bpmf
        self.maxw = max(len(k) for k in TW_WORDS)

    def tw_set(self, c):
        return {zy2py(z) for z in self.bpmf.get(c, [])} - {None}

    def single(self, c):
        if c in TW_SINGLE:
            return TW_SINGLE[c]
        tws = self.tw_set(c)
        if len(tws) == 1:
            return next(iter(tws))
        cands = [tone3(p) for p in pinyin(c, heteronym=True, style=Style.TONE)[0]]
        for p in cands:
            if not tws or p in tws:
                return p
        return cands[0]

    def predict(self, run):
        """run: str of hanzi -> list of (pinyin, source)"""
        s = T2S.convert(run)
        if len(s) != len(run):
            s = ''.join(T2S.convert(c) if len(T2S.convert(c)) == 1 else c for c in run)
        n = len(run)
        res = [None] * n
        i = 0                     # pass 1: curated zh-TW word readings win wherever they occur
        while i < n:
            for L in range(min(self.maxw, n - i), 1, -1):
                w = run[i:i + L]
                if w in TW_WORDS and len(TW_WORDS[w].split()) == L:
                    for k, p in enumerate(TW_WORDS[w].split()):
                        res[i + k] = (p, 'tw-word:' + w)
                    i += L; break
            else:
                i += 1
        i = 0                     # pass 2: pypinyin phrase dictionary (greedy longest match, not across pass-1 words)
        while i < n:
            if res[i]:
                i += 1; continue
            hit = 0
            for L in range(min(6, n - i), 1, -1):
                if any(res[i:i + L]):
                    continue
                w = s[i:i + L]
                if w in PHRASES_DICT and len(PHRASES_DICT[w]) == L:
                    for k, x in enumerate(PHRASES_DICT[w]):
                        res[i + k] = (tone3(x[0]), 'pypinyin:' + run[i:i + L])
                    hit = L; break
            i += hit or 1
        out = [r or (self.single(run[k]), 'single') for k, r in enumerate(res)]
        return out


def same(ann, pred, c):
    if ann is None or pred is None or ann == pred:
        return True
    if ann.endswith('5') or pred.endswith('5'):
        return True                                   # neutral tone: not forced
    if c in '一不' and ann[:-1] == pred[:-1]:
        return True                                   # 變調 handled by the voice
    return False


def runs_of(book):
    """yield (text, [zy...]) for each run of annotated chars (split at punctuation / unannotated chars)"""
    for bl in book['blocks']:
        for ln in bl.get('lines', []):
            ch, zs = list(ln[0]), ln[1].split()
            if len(ch) != len(zs):
                print('warn: zy count mismatch', book['id'], ln[0][:20], file=sys.stderr)
                continue
            cur = []
            for c, z in zip(ch, zs):
                if z == '-' or zy2py(z) is None:
                    if cur: yield cur
                    cur = []
                else:
                    cur.append((c, z))
            if cur: yield cur


def char_freq():
    import jieba
    f = collections.Counter()
    path = os.path.join(os.path.dirname(jieba.__file__), 'dict.txt')
    for line in open(path, encoding='utf-8'):
        p = line.split()
        if len(p) >= 2:
            for c in p[0]:
                f[c] += int(p[1])
    return f


PREFERRED = {  # hand-picked homophones (common, one reading only); used before the automatic choice
    'fu2': '福', 'ji3': '己', 'jian1': '堅', 'zhang3': '掌', 'she4': '社', 'she3': '捨', 'a1': None,
    'yang4': '樣', 'zang4': '葬', 'cang2': '倉', 'zhao4': '照', 'nan4': None, 'se4': '色', 'xing1': '星',
    'e1': '婀', 'bo1': '撥', 're3': '惹', 'na2': '拿', 'mo2': '模', 'qie2': '茄', 'nuo2': '挪', 'tuo2': '駝',
    'bo2': '博', 'po2': '婆', 'chi4': '赤', 'chang2': '常', 'zhong4': '眾', 'chong2': '蟲', 'le4': '勒',
    'yue4': '月', 'yao4': '要', 'xing4': '性', 'hang2': '航', 'shui4': '睡', 'jie4': '介', 'xie4': '謝',
    'wei4': '位', 'wei2': '維', 'yan1': '煙', 'yan3': '演', 'zhuo2': '酌', 'zhao2': '召', 'xiang4': '向',
    'ying4': '映', 'ying1': '英', 'liang2': '良', 'liang4': '亮', 'du2': '讀', 'duo2': '奪', 
    'shu3': '鼠', 'shuo4': '朔', 'diao4': '掉', 'tiao2': '條', 'he4': '賀', 'he2': '河',
    'huo4': '貨', 'qi2': '其', 'zhi1': '支', 'ga1': '嘎', 'jia1': '家', 'luo2': '羅', 'ruo3': '弱',
    'jiang4': '匠', 'qian3': '遣', 'shuai4': '帥', 'liao3': '瞭', 'de2': '德', 'jiang1': '江', 'xiang4': '向', 'chu3': '楚', 'chu4': '觸', 'hua1': '花', 'fu4': '父',
    'fo2': None,   # no common char reads fó except 佛 itself -> numbered pinyin fallback
}


def homophone(target, bpmf, pred, freq, avoid):
    if target in PREFERRED:
        return PREFERRED[target] if PREFERRED[target] not in avoid else None
    best = None
    for c, zs in bpmf.items():
        if len(c) != 1 or len(zs) != 1 or zy2py(zs[0]) != target or c in avoid:
            continue
        try:
            b = c.encode('big5')
        except Exception:
            continue
        if not (0xA440 <= int.from_bytes(b, 'big') <= 0xC67E):   # Big5 常用字
            continue
        if pred.single(c) != target:
            continue
        sc = freq.get(T2S.convert(c), 0)
        if best is None or sc > best[0]:
            best = (sc, c)
    return best and best[1]


def apply_subs(run, subs):
    """run: [(char, zy)] -> spoken list (one entry per char; a sub can replace several chars)"""
    out, i = [c for c, _ in run], 0
    zs = [z for _, z in run]
    text = ''.join(out)
    done = [False] * len(run)
    for s in sorted(subs, key=lambda s: -len(s['from'])):
        L, j = len(s['from']), text.find(s['from'])
        while j >= 0:
            if not any(done[j:j + L]) and ' '.join(zs[j:j + L]) == s['zy']:
                to = s['to'] if len(s['to']) == L else None
                for k in range(L):
                    out[j + k] = to[k] if to else (s['to'] if k == 0 else '')
                    done[j + k] = True
            j = text.find(s['from'], j + 1)
    return out


def build(book, pred, freq, bpmf):
    """one substitution per (char, 注音) that the predictor expects the voice to misread somewhere in the book;
    it is applied wherever that char carries that 注音 (harmless where the voice would have been right)."""
    occ, bad, ctx = collections.Counter(), collections.OrderedDict(), {}
    runs = list(runs_of(book))
    for run in runs:
        text = ''.join(c for c, _ in run)
        p = pred.predict(text)
        for i, (c, z) in enumerate(run):
            occ[(c, z)] += 1
            if not same(zy2py(z), p[i][0], c):
                e = bad.setdefault((c, z), {'n': 0, 'pred': collections.Counter(), 'ctx': []})
                e['n'] += 1
                e['pred'][p[i][0] + ('' if p[i][1] == 'single' else '（' + p[i][1] + '）')] += 1
                if len(e['ctx']) < 3:
                    e['ctx'].append(text[max(0, i - 2):i + 3])
    for (c, z), why in FORCE.items():
        if (c, z) in occ and (c, z) not in bad:
            ex = [''.join(x for x, _ in r)[max(0, i - 2):i + 3] for r in runs for i, (x, zz) in enumerate(r) if x == c and zz == z][:3]
            bad[(c, z)] = {'n': occ[(c, z)], 'pred': collections.Counter({'（強制）' + why: 1}), 'ctx': ex}
    subs = []
    for (c, z), e in bad.items():
        tgt = zy2py(z)
        h = homophone(tgt, bpmf, pred, freq, {c})
        subs.append({'from': c, 'to': h if h else ' %s ' % tgt, 'zy': z, 'count': occ[(c, z)], 'misread': e['n'],
                     'why': ('%s 注音 %s（%s），強制替換：%s；例：%s' % (c, z, tgt, FORCE[(c, z)], '／'.join(e['ctx']))) if (c, z) in FORCE and not any(not k.startswith('（強制）') for k in e['pred'])
                            else '%s 注音 %s（%s），語音可能唸 %s；例：%s' % (c, z, tgt, '、'.join(e['pred']), '／'.join(e['ctx']))})
    # verify: with all subs applied, the predicted reading of every run matches the 注音; a char that a substitution
    # pushed out of its word (e.g. 供 of 供養 once 養 -> 樣) gets its own substitution, up to 4 rounds
    for rnd in range(5):
        residual, extra = [], collections.OrderedDict()
        have = {(x['from'], x['zy']) for x in subs}
        for run in runs:
            sp = apply_subs(run, subs)
            sp2 = [x if len(x) == 1 else '　' for x in sp]   # a pinyin fallback is predicted as a pause
            p = pred.predict(''.join(sp2))
            for i, (c, z) in enumerate(run):
                if len(sp[i]) == 1 and not same(zy2py(z), p[i][0], sp[i]):
                    residual.append('%s→%s %s 預測 %s（%s）' % (''.join(x for x, _ in run)[max(0, i - 2):i + 3], sp[i], z, p[i][0], p[i][1]))
                    if (c, z) not in have and sp[i] == c:
                        e = extra.setdefault((c, z), [p[i][0], []])
                        if len(e[1]) < 3: e[1].append(''.join(x for x, _ in run)[max(0, i - 2):i + 3])
        if not extra or rnd == 4:
            break
        for (c, z), (pp, cx) in extra.items():
            tgt = zy2py(z)
            h = homophone(tgt, bpmf, pred, freq, {c})
            subs.append({'from': c, 'to': h if h else ' %s ' % tgt, 'zy': z, 'count': occ[(c, z)], 'misread': 0,
                         'why': '%s 注音 %s（%s），鄰字替換後語音可能唸 %s；例：%s' % (c, z, tgt, pp, '／'.join(cx))})
    subs.sort(key=lambda s: (-s['misread'], -s['count'], s['from']))
    return subs, residual


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--books', default=os.path.join(HERE, '..', 'mantra', 'reader', 'books'))
    ap.add_argument('--bpmf', default=DEF_BPMF)
    ap.add_argument('--report')
    a = ap.parse_args()
    bpmf = json.load(open(a.bpmf, encoding='utf-8'))
    pred, freq = Predictor(bpmf), char_freq()
    idx = json.load(open(os.path.join(a.books, 'index.json'), encoding='utf-8'))
    ids = a.ids or [b['id'] for b in idx['books']]
    rep = []
    for bid in ids:
        e = [b for b in idx['books'] if b['id'] == bid][0]
        book = json.load(open(os.path.join(a.books, e.get('file', bid + '.json')), encoding='utf-8'))
        subs, residual = build(book, pred, freq, bpmf)
        out = {'book': bid, 'generated_by': 'tools/gen_tts.py',
               'note': 'TTS-only substitutions for 朗讀; display text is unchanged. A sub applies where the text equals from AND its 注音 equals zy.',
               'subs': [{k: s[k] for k in ('from', 'to', 'zy', 'count', 'why')} for s in subs]}
        with open(os.path.join(a.books, bid + '.tts.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1); f.write('\n')
        rep.append('## %s %s（%d 條）\n' % (bid, book['title'], len(subs)))
        for s in subs:
            rep.append('- %s（%s）→ %s　共 %d 處　%s' % (s['from'], s['zy'], s['to'].strip(), s['count'], s['why']))
        if residual:
            rep.append('  殘留預測不符 %d：%s' % (len(residual), '；'.join(residual[:20])))
        rep.append('')
        print(bid, len(subs), file=sys.stderr)
    if a.report:
        open(a.report, 'w', encoding='utf-8').write('\n'.join(rep))
    else:
        print('\n'.join(rep))


if __name__ == '__main__':
    main()
