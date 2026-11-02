"""Telugu -> Latin helpers used by the database build and the API server.

Two outputs:
  * readable(s)  -> "Rukasar Phatima"   (shown next to the Telugu name)
  * key(s)       -> "rukasarpatima"     (sound key used for English search;
                                         spelling variants collapse to one key)
Both are pure Python, no packages needed.
"""
import re

CONS = {
    "క": "k", "ఖ": "kh", "గ": "g", "ఘ": "gh", "ఙ": "n",
    "చ": "ch", "ఛ": "chh", "జ": "j", "ఝ": "jh", "ఞ": "n",
    "ట": "t", "ఠ": "th", "డ": "d", "ఢ": "dh", "ణ": "n",
    "త": "t", "థ": "th", "ద": "d", "ధ": "dh", "న": "n",
    "ప": "p", "ఫ": "ph", "బ": "b", "భ": "bh", "మ": "m",
    "య": "y", "ర": "r", "ఱ": "r", "ల": "l", "ళ": "l", "ఴ": "l",
    "వ": "v", "శ": "sh", "ష": "sh", "స": "s", "హ": "h",
}
VOWELS = {
    "అ": "a", "ఆ": "aa", "ఇ": "i", "ఈ": "ee", "ఉ": "u", "ఊ": "oo",
    "ఋ": "ru", "ౠ": "ru", "ఌ": "lu", "ఎ": "e", "ఏ": "e", "ఐ": "ai",
    "ఒ": "o", "ఓ": "o", "ఔ": "au",
}
MATRAS = {
    "ా": "aa", "ి": "i", "ీ": "ee", "ు": "u", "ూ": "oo", "ృ": "ru", "ౄ": "ru",
    "ె": "e", "ే": "e", "ై": "ai", "ొ": "o", "ో": "o", "ౌ": "au",
}
VIRAMA = "్"
SIGNS = {"ం": "m", "ః": "h", "ఁ": "n"}
DIGITS = {chr(0x0C66 + i): str(i) for i in range(10)}
TELUGU = re.compile(r"[ఀ-౿]")


def to_latin(s):
    """Letter-by-letter Telugu to Latin; other characters pass through."""
    out = []
    s = s or ""
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch in CONS:
            out.append(CONS[ch])
            nxt = s[i + 1] if i + 1 < n else ""
            if nxt in MATRAS:
                out.append(MATRAS[nxt]); i += 2; continue
            if nxt == VIRAMA:
                i += 2; continue
            if nxt == "఼":  # nukta
                i += 1
            out.append("a")
        elif ch in VOWELS:
            out.append(VOWELS[ch])
        elif ch in SIGNS:
            out.append(SIGNS[ch])
        elif ch in DIGITS:
            out.append(DIGITS[ch])
        elif ch in MATRAS or ch == VIRAMA:
            out.append(MATRAS.get(ch, ""))
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def readable(s):
    """'రుకసర్ ఫాతిమ' -> 'Rukasar Phaatima' (simplified a bit for reading)."""
    t = to_latin(s).replace("aa", "a")
    t = re.sub(r"ee\b", "i", t)                       # Lakshmee -> Lakshmi
    t = re.sub(r"m(?=[kgcjtdnszyrlvh])", "n", t)       # Vemkat -> Venkat
    words = re.split(r"(\s+)", t)
    return "".join(w[:1].upper() + w[1:] if w.strip() else w for w in words).strip()


_REPS = [("naidu", "nayudu"), ("aiah", "aya"), ("iah", "ya"), ("ou", "au"), ("chh", "c"), ("ch", "c"), ("kh", "k"), ("gh", "g"), ("jh", "j"),
         ("th", "t"), ("dh", "d"), ("ph", "p"), ("bh", "b"), ("sh", "s"), ("aa", "a"), ("ee", "i"),
         ("ii", "i"), ("oo", "u"), ("uu", "u"), ("ow", "au"), ("w", "v"), ("z", "j"), ("q", "k"),
         ("x", "ks"), ("f", "p")]


def norm_latin(s):
    """Latin spellings of Telugu names vary (Sandhya / Sandya / Samdya); reduce to a sound key."""
    s = re.sub(r"[^a-z ]+", " ", (s or "").lower())
    for a, b in _REPS:
        s = s.replace(a, b)
    s = s.replace("ru", "ri")
    s = re.sub(r"([^aeiou ])y\b", r"\1i", s)          # reddy -> reddi
    s = re.sub(r"m(?=[kgcjtdnszyrlvh])", "n", s)       # anusvara before a consonant
    s = re.sub(r"(?<=[aeiou])h\b", "", s)            # trailing h: krishnah, ramaiah
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def word_keys(s):
    """Sound key for each word, Telugu or Latin input."""
    lat = to_latin(s) if TELUGU.search(s or "") else (s or "")
    return [k for k in (norm_latin(w).replace(" ", "") for w in lat.split()) if k]


def key(s):
    """One joined sound key, used for substring search."""
    return "".join(word_keys(s))
