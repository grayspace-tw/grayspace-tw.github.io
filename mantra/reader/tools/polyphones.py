#!/usr/bin/env python3
"""破音字 review list for the six books: every annotated character that has more than one reading
(教育部 bpmf table ∪ pypinyin heteronyms), grouped by (char, 注音).  Writes polyphones_review.csv (UTF-8 BOM) and
polyphones_review.md (繁體中文 summary).  Since 2026-11-20 every polyphonic char is replaced deterministically
(tools/tts_subs.py); the 處理 column says what the reader does and 風險 is what is left:
  高 = River heard it wrong (PINNED, already fixed) or numbered-pinyin fallback (only Google voices get the pinyin;
       other voices say the original char and may pick the other reading)
  中 = said as the original char (一/不 tone sandhi, no one-reading homophone, or only a rare one): the voice's default
       reading is the annotated one, but it may still pick another in some word
  低 = replaced by a one-reading homophone for every voice
usage: python3 tools/polyphones.py [--out DIR]"""
import argparse, collections, csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_tts as G
import tts_subs as TS
from pypinyin import pinyin, Style
from zhuyin_pinyin import zhuyin_token_to_pinyin

def base(p): return p[:-1] if p and p[-1].isdigit() else p

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(G.HERE, '..'))
    ap.add_argument('--books', default=os.path.join(G.HERE, '..', 'books'))
    a = ap.parse_args()
    bpmf = json.load(open(G.DEF_BPMF, encoding='utf-8')); pred = G.Predictor(bpmf); TR = TS.Readings(bpmf)
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
        kinds = {(s['from'], s['zy']): s.get('kind', '') for s in subs}
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
                                             'ctx': [], 'sub': {}, 'kind': '', 'pred_bad': collections.Counter()})
                r['n'] += 1; r['books'][bid] += 1
                cx = text[max(0, i - 3):i + 4]
                if cx not in r['ctx'] and len(r['ctx']) < 4: r['ctx'].append(cx)
                if (c, z) in sub: r['sub'][bid] = sub[(c, z)]; r['kind'] = kinds[(c, z)]
                if not G.same(ann, p[i][0], c): r['pred_bad'][p[i][0]] += 1
    out = []
    for (c, z), r in rows.items():
        ann = r['ann']; dflt = pred.single(c)
        sc = G.T2S.convert(c); cnt = pr.get(sc, {})
        common_alt = [x for x in r['others'] if cnt.get(x, 0) >= 30]
        kind = r['kind']
        if (c, z) in TS.PINNED or kind == 'pinyin':
            risk = '高'
        elif not r['sub'] and not (TR.moe(c) == {ann} and TR.dominant(c) == (ann, True)):
            risk = '中'
        else:
            risk = '低'
        why = []
        if (c, z) in G.FORCE: why.append(G.FORCE[(c, z)])
        how = {'pinned': '指定換字', 'pinyin': '拼音（只 Google）', 'homophone1': '換同音字', 'homophone2': '換同音字', 'homophone3': '換同音字（人工挑選）'}.get(r['kind'], '照原字' if risk == '中' else '照原字（實際只有一個讀音）')
        if r['pred_bad']: why.append('預測語音會唸 ' + '、'.join(r['pred_bad']))
        if dflt != ann: why.append('單字預設讀 %s，要靠語音認得詞' % dflt)
        if common_alt: why.append('另一讀音常用（詞典 %s）' % '、'.join('%s×%d' % (x, cnt[x]) for x in common_alt))
        to = sorted(set(r['sub'].values()))
        out.append({'字': c, '注音': z, '拼音': ann, '其他讀音': ' '.join(r['others']), '次數': r['n'],
                    '經': ' '.join('%s×%d' % kv for kv in r['books'].items()), '例句': '／'.join(r['ctx']),
                    '替換': ('→' + '/'.join(to)) if to else '', '處理': how, '風險': risk, '說明': '；'.join(why)})
    order = {'高': 0, '中': 1, '低': 2}
    out.sort(key=lambda x: (order[x['風險']], -x['次數']))
    with open(os.path.join(a.out, 'polyphones_review.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
    tot = collections.Counter(x['風險'] for x in out); occ = collections.Counter()
    for x in out: occ[x['風險']] += x['次數']
    md = ['# 經文破音字檢查表', '',
          '範圍：' + '、'.join(e['title'] for e in idx['books']) + ' 裡所有標了注音、而且字典（教育部注音表＋pypinyin）有兩個以上讀音的字。'
          '同一個字不同注音分開列。完整清單在 polyphones_review.csv（Excel 可直接開）。', '',
          '共 %d 組（字＋注音），%d 處。高 %d 組（%d 處）、中 %d 組（%d 處）、低 %d 組（%d 處）。' %
          (len(out), sum(occ.values()), tot['高'], occ['高'], tot['中'], occ['中'], tot['低'], occ['低']), '',
          '朗讀換字規則（River 2026-11-20）：每個破音字一律換成「只有一個讀音、就是注音那個讀音」的常用同音字給語音唸，畫面不變（tools/tts_subs.py）。',
          '', '- 高：River 聽過唸錯、已指定換字的（不 ㄈㄡˇ→否、幢→床、淺→遣、得→德）；或找不到同音字、只能送拼音的（只有 Google 語音會照拼音唸，其他語音照原字唸，可能唸錯）。',
          '- 中：照原字唸。「一」「不」要讓語音自己變調；或找不到單一讀音的常用同音字、而注音就是這個字平常的讀音（如 佛、說、大）。建議試聽。',
          '- 低：已換成單一讀音的同音字，每種語音都會照注音唸；或這個字實際上只有一個讀音（另一讀音只見於古書／罕用），照原字唸。', '',
          '## 讀音規則', '',
          '- 「一」「不」標本調，變調交給語音。',
          '- 「不」作「否」讀 ㄈㄡˇ（River 2026-11-20）：問句句尾（「功德多不？」「寧為多不？」「汝為信不？」）和答語「不也，世尊！」，注音標 ㄈㄡˇ，朗讀換成「否」。每一處破音字的注音都由逐處判讀決定（tools/readings/decisions/<id>.tsv，見 TTS-NOTES.md）。'
          '「云何菩薩不受福德？」這類句中否定的「不」、答句「不也」仍讀 ㄅㄨˋ。', '',
          '## 高', '', '| 字 | 注音 | 處理 | 次數 | 例 | 說明 |', '|---|---|---|---|---|---|']
    for x in out:
        if x['風險'] == '高': md.append('| %s | %s | %s %s | %d | %s | %s |' % (x['字'], x['注音'], x['處理'], x['替換'].lstrip('→'), x['次數'], x['例句'].split('／')[0], x['說明'][:80]))
    md += ['', '## 中（照原字唸，建議試聽）', '', '| 字 | 注音 | 其他讀音 | 次數 | 例 | 說明 |', '|---|---|---|---|---|---|']
    for x in out:
        if x['風險'] == '中': md.append('| %s | %s | %s | %d | %s | %s |' % (x['字'], x['注音'], x['其他讀音'], x['次數'], x['例句'].split('／')[0], x['說明'][:80]))
    md += ['', '## 低：已換同音字', '', '| 字 | 注音 | 唸成 | 次數 | 例 |', '|---|---|---|---|---|']
    for x in out:
        if x['風險'] == '低' and x['替換']: md.append('| %s | %s | %s | %d | %s |' % (x['字'], x['注音'], x['替換'].lstrip('→'), x['次數'], x['例句'].split('／')[0]))
    md += ['', '## 低：照原字（實際只有一個讀音）', '', '、'.join('%s %s×%d' % (x['字'], x['注音'], x['次數']) for x in out if x['風險'] == '低' and not x['替換'])]
    open(os.path.join(a.out, 'polyphones_review.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    print(len(out), dict(tot), dict(occ))

if __name__ == '__main__':
    main()
