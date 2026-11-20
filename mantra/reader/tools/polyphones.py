#!/usr/bin/env python3
"""破音字 review list for the six books: every annotated character that has more than one reading
(教育部 bpmf table ∪ pypinyin heteronyms), grouped by (char, 注音).  Writes polyphones_review.csv (UTF-8 BOM) and
polyphones_review.md (繁體中文 summary).  Risk:
  高 = a TTS substitution is applied (predictor expects a misread, or a known/heard trap in gen_tts.FORCE)
  中 = the annotated reading is NOT the character's everyday default, so it is only right if the voice knows the
       word (e.g. 長老 zhǎng); or the other reading is a common one in everyday words (≥ 30 dictionary words)
  低 = annotated reading is the everyday default and the other readings are rare/literary
usage: python3 tools/polyphones.py [--out DIR]"""
import argparse, collections, csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_tts as G
from pypinyin import pinyin, Style
from zhuyin_pinyin import zhuyin_token_to_pinyin

def base(p): return p[:-1] if p and p[-1].isdigit() else p

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(G.HERE, '..'))
    ap.add_argument('--books', default=os.path.join(G.HERE, '..', 'mantra', 'reader', 'books'))
    a = ap.parse_args()
    bpmf = json.load(open(G.DEF_BPMF, encoding='utf-8')); pred = G.Predictor(bpmf)
    # how often each reading of a (simplified) char occurs in pypinyin's phrase dictionary
    pr = collections.defaultdict(collections.Counter)
    for w, ps in G.PHRASES_DICT.items():
        if len(w) == len(ps):
            for ch, p in zip(w, ps): pr[ch][G.tone3(p[0])] += 1
    idx = json.load(open(os.path.join(a.books, 'index.json'), encoding='utf-8'))
    rows = collections.OrderedDict()
    for e in idx['books']:
        bid = e['id']; book = json.load(open(os.path.join(a.books, bid + '.json'), encoding='utf-8'))
        subs = json.load(open(os.path.join(a.books, bid + '.tts.json'), encoding='utf-8'))['subs']
        sub = {(s['from'], s['zy']): s['to'].strip() for s in subs}
        for run in G.runs_of(book):
            text = ''.join(c for c, _ in run); p = pred.predict(text)
            for i, (c, z) in enumerate(run):
                ann = G.zy2py(z)
                rd = {G.zy2py(x) for x in bpmf.get(c, [])} | {G.tone3(x) for x in pinyin(c, heteronym=True, style=Style.TONE)[0]}
                rd = {x for x in rd if x and not x.endswith('5')}
                others = sorted(x for x in rd if x != ann)
                if not others: continue
                if c in '一不' and all(base(x) == base(ann) for x in others): continue   # tone sandhi only
                r = rows.setdefault((c, z), {'c': c, 'z': z, 'ann': ann, 'others': others, 'n': 0, 'books': collections.Counter(),
                                             'ctx': [], 'sub': {}, 'pred_bad': collections.Counter()})
                r['n'] += 1; r['books'][bid] += 1
                cx = text[max(0, i - 3):i + 4]
                if cx not in r['ctx'] and len(r['ctx']) < 4: r['ctx'].append(cx)
                if (c, z) in sub: r['sub'][bid] = sub[(c, z)]
                if not G.same(ann, p[i][0], c): r['pred_bad'][p[i][0]] += 1
    out = []
    for (c, z), r in rows.items():
        ann = r['ann']; dflt = pred.single(c)
        sc = G.T2S.convert(c); cnt = pr.get(sc, {})
        common_alt = [x for x in r['others'] if cnt.get(x, 0) >= 30]
        if r['sub'] or (c, z) in G.FORCE:
            risk = '高'
        elif dflt != ann and not (c in '一不' and base(dflt) == base(ann)):
            risk = '中'
        elif common_alt:
            risk = '中'
        else:
            risk = '低'
        why = []
        if (c, z) in G.FORCE: why.append(G.FORCE[(c, z)])
        if r['pred_bad']: why.append('預測語音會唸 ' + '、'.join(r['pred_bad']))
        if dflt != ann: why.append('單字預設讀 %s，要靠語音認得詞' % dflt)
        if common_alt: why.append('另一讀音常用（詞典 %s）' % '、'.join('%s×%d' % (x, cnt[x]) for x in common_alt))
        to = sorted(set(r['sub'].values()))
        out.append({'字': c, '注音': z, '拼音': ann, '其他讀音': ' '.join(r['others']), '次數': r['n'],
                    '經': ' '.join('%s×%d' % kv for kv in r['books'].items()), '例句': '／'.join(r['ctx']),
                    '替換': ('→' + '/'.join(to)) if to else '', '風險': risk, '說明': '；'.join(why)})
    order = {'高': 0, '中': 1, '低': 2}
    out.sort(key=lambda x: (order[x['風險']], -x['次數']))
    with open(os.path.join(a.out, 'polyphones_review.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
    tot = collections.Counter(x['風險'] for x in out); occ = collections.Counter()
    for x in out: occ[x['風險']] += x['次數']
    md = ['# 六部經破音字檢查表', '',
          '範圍：大勢至章、普門品、祈請文、阿彌陀經、藥師經、金剛經裡所有標了注音、而且字典（教育部注音表＋pypinyin）有兩個以上讀音的字。'
          '同一個字不同注音分開列。完整清單在 polyphones_review.csv（Excel 可直接開）。', '',
          '共 %d 組（字＋注音），%d 處。高風險 %d 組（%d 處，全部已加朗讀替換）、中 %d 組（%d 處）、低 %d 組（%d 處）。' %
          (len(out), sum(occ.values()), tot['高'], occ['高'], tot['中'], occ['中'], tot['低'], occ['低']), '',
          '- 高：已經換成同音字給語音唸（畫面不變）。包括預測語音會唸錯的，和實際聽到／量到唸錯的（淺、得）。',
          '- 中：注音不是這個字平常的讀音，要語音認得這個詞才會唸對；或另一個讀音在日常詞很常見。建議優先試聽。',
          '- 低：注音就是平常讀音，另一個讀音很少見。', '', '## 高風險（已替換）', '',
          '| 字 | 注音 | 唸成 | 次數 | 例 | 說明 |', '|---|---|---|---|---|---|']
    for x in out:
        if x['風險'] == '高': md.append('| %s | %s | %s | %d | %s | %s |' % (x['字'], x['注音'], x['替換'].lstrip('→'), x['次數'], x['例句'].split('／')[0], x['說明'][:80]))
    md += ['', '## 中風險（未替換，建議試聽）', '', '| 字 | 注音 | 其他讀音 | 次數 | 例 | 說明 |', '|---|---|---|---|---|---|']
    for x in out:
        if x['風險'] == '中': md.append('| %s | %s | %s | %d | %s | %s |' % (x['字'], x['注音'], x['其他讀音'], x['次數'], x['例句'].split('／')[0], x['說明'][:80]))
    open(os.path.join(a.out, 'polyphones_review.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    print(len(out), dict(tot), dict(occ))

if __name__ == '__main__':
    main()
