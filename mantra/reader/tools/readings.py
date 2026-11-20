#!/usr/bin/env python3
"""逐句判讀破音字（River 2026-11-20）：注音由「每一處」的語意／詞性判斷決定，不是由固定規則決定。

檔案（都在 tools/readings/）：
  decisions/<id>.tsv  每一處破音字一列：這一處讀什麼、為什麼。建書時照這裡套注音（朗讀換字 tts.json 再依注音產生）。
  lexicon.tsv         過去判讀過的慣用讀音（記憶）：審新經時拿來「建議」與檢查前後一致；不會自己套用。

破音字＝教育部注音表 ∪ pypinyin 有兩個以上讀音的字（或注音不是它的任何已知讀音）。

建書（build_books.py／html2book.py／sutra2book.py）在產生注音後呼叫 apply(book)：
  - 有判讀紀錄的位置：核對字與上下文都一樣，套上判讀的注音；上下文不同（經文改過）就報錯，要重審。
  - 沒有判讀紀錄的破音字：照原注音輸出，但列出來（--strict 時建書失敗）。新經一定要先審完。

指令：
  python3 tools/readings.py sheet <books_dir> <id> [--out 審讀表.tsv]   列出這本經所有破音字（含詞典依據、慣用讀音建議、尚未判讀的標 todo）
  python3 tools/readings.py check <books_dir> [ids…]                  每本經：破音字處數、已判讀、待審、和詞庫不一致的地方
  python3 tools/readings.py apply <books_dir> <id>                    把判讀套到既有的 books/<id>.json（並重產 <id>.tts.json）

decisions/<id>.tsv 欄位（Tab 分隔，# 開頭是註解）：
  blk  ln  i  字  注音  狀態  原注音  依據  理由  上下文
  blk/ln/i：第幾段、第幾行、行內第幾個字（0 起算）。注音：判讀結果。
  狀態：keep＝原注音正確；change＝改讀（原注音欄是建書工具原本給的）；ask＝不確定、先照原注音、等 River 決定。
  依據：lexicon.tsv 的 id，或「詞:某詞」（教育部詞條），或「單讀」（教育部只有一個讀音），或「句意」。
  上下文：前後各 4 字，字本身用 [ ] 標出；建書時用來確認位置沒有跑掉。
"""
import collections, csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RDIR = os.path.join(HERE, 'readings')
COLS = ['blk', 'ln', 'i', '字', '注音', '狀態', '原注音', '依據', '理由', '上下文']
LEXCOLS = ['id', '字', '注音', '朗讀', '前文', '後文', '語境', '例句', '理由', '來源', '範圍', '決定']


def ctx_of(text, i, k=4):
    return text[max(0, i - k):i] + '[' + text[i] + ']' + text[i + 1:i + 1 + k]


def _rows(path, cols):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding='utf-8') as f:
        for ln in f:
            ln = ln.rstrip('\n')
            if not ln or ln.startswith('#'):
                continue
            v = ln.split('\t')
            if v[0] == cols[0]:
                continue
            out.append(dict(zip(cols, v + [''] * (len(cols) - len(v)))))
    return out


def load_lexicon(path=None):
    return _rows(path or os.path.join(RDIR, 'lexicon.tsv'), LEXCOLS)


def load_decisions(book_id, ddir=None):
    rows = _rows(os.path.join(ddir or os.path.join(RDIR, 'decisions'), book_id + '.tsv'), COLS)
    return {(int(r['blk']), int(r['ln']), int(r['i'])): r for r in rows}


def write_decisions(book_id, rows, ddir=None, header=''):
    p = os.path.join(ddir or os.path.join(RDIR, 'decisions'), book_id + '.tsv')
    rows = sorted(rows, key=lambda r: (int(r['blk']), int(r['ln']), int(r['i'])))
    with open(p, 'w', encoding='utf-8') as f:
        if header:
            f.write(''.join('# ' + h + '\n' for h in header.splitlines()))
        f.write('\t'.join(COLS) + '\n')
        for r in rows:
            f.write('\t'.join(str(r.get(c, '')) for c in COLS) + '\n')
    return p


def polyphone_occurrences(book, R=None):
    """yield (blk, ln, i, char, zy, text) for every 破音字 occurrence."""
    import tts_subs
    R = R or tts_subs.Readings()
    for bi, bl in enumerate(book['blocks']):
        for li, ln in enumerate(bl.get('lines', [])):
            t, zs = ln[0], ln[1].split()
            for i, (c, z) in enumerate(zip(t, zs)):
                if z == '-':
                    continue
                rs = R.all(c)
                if len(rs) > 1 or tts_subs.zy2py(z) not in rs:
                    yield bi, li, i, c, z, t


def lex_match(lex, text, i):
    """lexicon rows whose 字 is text[i] and whose 前文/後文 conditions (regex, anchored at the char) hold. Suggestions only."""
    out = []
    for r in lex:
        if r['字'] != text[i]:
            continue
        if r['前文'] and not re.search('(?:' + r['前文'] + ')$', text[:i]):
            continue
        if r['後文'] and not re.match(r['後文'], text[i + 1:]):
            continue
        out.append(r)
    return out


def apply(book, ddir=None, strict=False, log=sys.stderr):
    """Set each decided occurrence's 注音 from decisions/<id>.tsv. Returns stats dict. Raises on context drift."""
    D = load_decisions(book['id'], ddir)
    st = collections.Counter(); undecided = []
    seen = set()
    byline = collections.defaultdict(list)
    for k, v in D.items():
        byline[k[:2]].append((k, v))
    for bi, bl in enumerate(book['blocks']):
        for li, ln in enumerate(bl.get('lines', [])):
            t, zs = ln[0], ln[1].split()
            for (b, l, i), r in byline.get((bi, li), []):
                if i >= len(t) or t[i] != r['字'] or ctx_of(t, i) != r['上下文']:
                    raise SystemExit('readings: %s %d/%d/%d context drift: decision %s %s vs text %s — re-review this place'
                                     % (book['id'], b, l, i, r['字'], r['上下文'], ctx_of(t, i) if i < len(t) else '?'))
                seen.add((b, l, i))
                if zs[i] != r['注音']:
                    zs[i] = r['注音']; st['set'] += 1
                st[r['狀態']] += 1
            ln[1] = ' '.join(zs)
    for b, l, i, c, z, t in polyphone_occurrences(book):
        if (b, l, i) not in seen:
            undecided.append((b, l, i, c, z, ctx_of(t, i)))
    st['undecided'] = len(undecided)
    if undecided:
        print('readings: %s has %d 破音字 occurrence(s) without a decision (run tools/readings.py sheet); first: %s'
              % (book['id'], len(undecided), undecided[:5]), file=log)
        if strict:
            raise SystemExit('readings: --strict and undecided occurrences in %s' % book['id'])
    missing = set(D) - seen
    if missing:
        raise SystemExit('readings: %s decisions point outside the text: %s' % (book['id'], sorted(missing)[:5]))
    return st


def sheet(book, lex=None, ddir=None):
    """All 破音字 occurrences with the current decision (if any) or a todo row carrying the lexicon suggestion."""
    lex = lex if lex is not None else load_lexicon()
    D = load_decisions(book['id'], ddir)
    rows = []
    for b, l, i, c, z, t in polyphone_occurrences(book):
        if (b, l, i) in D:
            rows.append(D[(b, l, i)]); continue
        sug = lex_match(lex, t, i)
        rows.append(dict(blk=b, ln=l, i=i, 字=c, 注音=sug[0]['注音'] if sug else z, 狀態='todo', 原注音=z,
                         依據=sug[0]['id'] if sug else '', 理由='（待審：讀整句判斷）' + ('建議 ' + sug[0]['注音'] if sug else ''),
                         上下文=ctx_of(t, i)))
    return rows


def check(book, lex=None, ddir=None):
    lex = lex if lex is not None else load_lexicon()
    D = load_decisions(book['id'], ddir)
    n = 0; todo = []; conflict = []; stc = collections.Counter()
    for b, l, i, c, z, t in polyphone_occurrences(book):
        n += 1
        r = D.get((b, l, i))
        if not r:
            todo.append((b, l, i, ctx_of(t, i))); continue
        stc[r['狀態']] += 1
        for s in lex_match(lex, t, i):
            if not (s['前文'] or s['後文']):
                continue          # context-free rows are a glossary of senses, not a default to compare against
            if s['注音'] != r['注音'] and r['依據'] != s['id'] and r['狀態'] != 'ask':
                conflict.append((b, l, i, ctx_of(t, i), r['注音'], s['id'], s['注音']))
    return dict(occurrences=n, decided=sum(stc.values()), status=dict(stc), todo=todo, conflicts=conflict)


if __name__ == '__main__':
    import argparse
    sys.path.insert(0, HERE)
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['sheet', 'check', 'apply'])
    ap.add_argument('books'); ap.add_argument('ids', nargs='*'); ap.add_argument('--out')
    a = ap.parse_args()
    ids = a.ids or [e['id'] for e in json.load(open(os.path.join(a.books, 'index.json'), encoding='utf-8'))['books']]
    for bid in ids:
        p = os.path.join(a.books, bid + '.json'); book = json.load(open(p, encoding='utf-8'))
        if a.cmd == 'check':
            r = check(book)
            print(bid, 'occurrences', r['occurrences'], 'decided', r['decided'], r['status'], 'todo', len(r['todo']), 'conflicts', len(r['conflicts']))
            for x in r['conflicts'][:20]: print('  conflict', x)
            for x in r['todo'][:20]: print('  todo', x)
        elif a.cmd == 'sheet':
            rows = sheet(book); out = a.out or (bid + '.review.tsv')
            with open(out, 'w', encoding='utf-8') as f:
                f.write('\t'.join(COLS) + '\n')
                for r in rows: f.write('\t'.join(str(r.get(c, '')) for c in COLS) + '\n')
            print(out, len(rows), 'rows', sum(1 for r in rows if r['狀態'] == 'todo'), 'todo')
        else:
            import tts_subs
            st = apply(book)
            with open(p, 'w', encoding='utf-8') as f: json.dump(book, f, ensure_ascii=False, indent=1); f.write('\n')
            tts_subs.write_tts(book, a.books)
            print(bid, dict(st))
