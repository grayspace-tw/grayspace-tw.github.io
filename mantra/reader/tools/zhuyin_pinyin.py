#!/usr/bin/env python3
"""Map Taiwan Zhuyin (Bopomofo) syllables to Hanyu Pinyin (tone marks or numbers)."""

from __future__ import annotations

TONE_MARKS = {"ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5}
TONE_CHARS = {
    "a": "aāáǎà",
    "e": "eēéěè",
    "i": "iīíǐì",
    "o": "oōóǒò",
    "u": "uūúǔù",
    "ü": "üǖǘǚǜ",
}

# Bare initials (syllabic): ㄓㄔㄕㄖㄗㄘㄙ
BARE_INITIAL = {
    "ㄅ": "b", "ㄆ": "p", "ㄇ": "m", "ㄈ": "f",
    "ㄉ": "d", "ㄊ": "t", "ㄋ": "n", "ㄌ": "l",
    "ㄍ": "g", "ㄎ": "k", "ㄏ": "h",
    "ㄐ": "j", "ㄑ": "q", "ㄒ": "x",
    "ㄓ": "zh", "ㄔ": "ch", "ㄕ": "sh", "ㄖ": "r",
    "ㄗ": "z", "ㄘ": "c", "ㄙ": "s",
}

FINALS = {
    "ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "ê",
    "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou",
    "ㄢ": "an", "ㄣ": "en", "ㄤ": "ang", "ㄥ": "eng",
    "ㄦ": "er",
    "ㄧ": "i", "ㄨ": "u", "ㄩ": "ü",
    "ㄧㄚ": "ia", "ㄧㄛ": "io", "ㄧㄝ": "ie", "ㄧㄞ": "iai",
    "ㄧㄠ": "iao", "ㄧㄡ": "iu",
    "ㄧㄢ": "ian", "ㄧㄣ": "in", "ㄧㄤ": "iang", "ㄧㄥ": "ing",
    "ㄨㄚ": "ua", "ㄨㄛ": "uo", "ㄨㄞ": "uai", "ㄨㄟ": "ui",
    "ㄨㄢ": "uan", "ㄨㄣ": "un", "ㄨㄤ": "uang", "ㄨㄥ": "ong",
    "ㄩㄝ": "üe", "ㄩㄢ": "üan", "ㄩㄣ": "ün", "ㄩㄥ": "iong",
}

SYLLABIC_INITIALS = {"ㄓ": "zhi", "ㄔ": "chi", "ㄕ": "shi", "ㄖ": "ri",
                     "ㄗ": "zi", "ㄘ": "ci", "ㄙ": "si"}


def _apply_tone_mark(syllable: str, tone: int) -> str:
    if tone in (0, 1, 5) or tone is None:
        # tone 1 keeps macron; tone 5 (neutral) has no mark
        if tone != 1:
            return syllable
        # tone 1
        pass
    # Find vowel to mark: a, then o/e, else last vowel; iu/ui -> second vowel
    s = syllable
    if "a" in s:
        idx = s.index("a")
        key = "a"
    elif "o" in s and "e" not in s:
        idx = s.index("o")
        key = "o"
    elif "e" in s:
        idx = s.index("e")
        key = "e"
    elif "iu" in s:
        idx = s.index("u")
        key = "u"
    elif "ui" in s:
        idx = s.index("i")
        key = "i"
    else:
        for i in range(len(s) - 1, -1, -1):
            if s[i] in TONE_CHARS:
                idx, key = i, s[i]
                break
        else:
            return s
    marks = TONE_CHARS[key]
    # marks[0] is base; 1=tone1 ... 4=tone4
    if tone == 5:
        return s
    return s[:idx] + marks[tone] + s[idx + 1 :]


def _bare_medial(final_py: str, final_zy: str) -> str:
    """Rewrite when there is no initial (yi/wu/yu / ya/wa/yue ...)."""
    if final_zy == "ㄧ":
        return "yi"
    if final_zy == "ㄨ":
        return "wu"
    if final_zy == "ㄩ":
        return "yu"
    if final_zy.startswith("ㄧ"):
        # ia -> ya, ie -> ye, iao -> yao, iu -> you, ian -> yan, in -> yin,
        # iang -> yang, ing -> ying, io -> yo, iai -> yai
        if final_py == "iu":
            return "you"
        if final_py == "in":
            return "yin"
        if final_py == "ing":
            return "ying"
        return "y" + final_py[1:] if final_py.startswith("i") else "y" + final_py
    if final_zy.startswith("ㄨ"):
        if final_zy == "ㄨㄥ":
            return "weng"
        if final_py == "un":
            return "wen"
        if final_py == "ui":
            return "wei"
        if final_py.startswith("u"):
            return "w" + final_py[1:]
        return "w" + final_py
    if final_zy.startswith("ㄩ"):
        # üe -> yue, üan -> yuan, ün -> yun, iong already
        if final_py == "iong":
            return "yong"
        if final_py.startswith("ü"):
            return "yu" + final_py[1:]
        return "yu" + final_py
    return final_py


def _with_initial(initial: str, final_py: str, final_zy: str) -> str:
    # j/q/x + ü -> u (ju, jue, juan, jun)
    if initial in ("j", "q", "x") and final_py.startswith("ü"):
        final_py = "u" + final_py[1:]
    # ㄨㄥ with initial is ong (already). ㄩㄥ is iong.
    return initial + final_py


def zhuyin_token_to_pinyin(token: str, numbered: bool = False) -> str | None:
    """Convert one zhuyin token (e.g. ㄖㄨˊ or ㄍㄨ or '-') to pinyin.

    Returns None for punctuation placeholders such as '-'.
    """
    token = token.strip()
    if not token or token == "-":
        return None
    tone = 1
    body = token
    # tone may be at end, or ˙ at start (neutral)
    if body.startswith("˙"):
        tone = 5
        body = body[1:]
    elif body and body[-1] in TONE_MARKS:
        tone = TONE_MARKS[body[-1]]
        body = body[:-1]
    if not body:
        return None

    if body in SYLLABIC_INITIALS and len(body) == 1:
        py = SYLLABIC_INITIALS[body]
    elif body[0] in BARE_INITIAL and len(body) > 1:
        initial = BARE_INITIAL[body[0]]
        rest = body[1:]
        if rest not in FINALS:
            raise ValueError(f"Unmapped zhuyin token: {token!r} body={body!r}")
        py = _with_initial(initial, FINALS[rest], rest)
    elif body in FINALS:
        py = _bare_medial(FINALS[body], body)
    else:
        raise ValueError(f"Unmapped zhuyin token: {token!r} body={body!r}")

    if numbered:
        num = py.replace("ü", "v")
        return f"{num}{tone}"
    return _apply_tone_mark(py, tone)


def zhuyin_string_to_pinyin(s: str, numbered: bool = False) -> str:
    out = []
    for tok in s.split():
        py = zhuyin_token_to_pinyin(tok, numbered=numbered)
        if py is not None:
            out.append(py)
    return " ".join(out)


if __name__ == "__main__":
    samples = "ㄖㄨˊ ㄕˋ ㄨㄛˇ ㄨㄣˊ - ㄧ ㄕˊ - ㄈㄛˊ ㄗㄞˋ ㄕㄜˋ ㄨㄟˋ ㄍㄨㄛˊ ㄑㄧˊ ㄕㄨˋ ㄐㄧˇ ㄍㄨ ㄉㄨˊ ㄩㄢˊ"
    print("marks:", zhuyin_string_to_pinyin(samples, False))
    print("nums: ", zhuyin_string_to_pinyin(samples, True))
