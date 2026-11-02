// Telugu -> Latin, same rules as scripts/telugu.py (search keys must match the build exactly).
const CONS = { "క": "k", "ఖ": "kh", "గ": "g", "ఘ": "gh", "ఙ": "n", "చ": "ch", "ఛ": "chh", "జ": "j", "ఝ": "jh", "ఞ": "n",
  "ట": "t", "ఠ": "th", "డ": "d", "ఢ": "dh", "ణ": "n", "త": "t", "థ": "th", "ద": "d", "ధ": "dh", "న": "n",
  "ప": "p", "ఫ": "ph", "బ": "b", "భ": "bh", "మ": "m", "య": "y", "ర": "r", "ఱ": "r", "ల": "l", "ళ": "l", "ఴ": "l",
  "వ": "v", "శ": "sh", "ష": "sh", "స": "s", "హ": "h" };
const VOWELS = { "అ": "a", "ఆ": "aa", "ఇ": "i", "ఈ": "ee", "ఉ": "u", "ఊ": "oo", "ఋ": "ru", "ౠ": "ru", "ఌ": "lu",
  "ఎ": "e", "ఏ": "e", "ఐ": "ai", "ఒ": "o", "ఓ": "o", "ఔ": "au" };
const MATRAS = { "ా": "aa", "ి": "i", "ీ": "ee", "ు": "u", "ూ": "oo", "ృ": "ru", "ౄ": "ru", "ె": "e", "ే": "e",
  "ై": "ai", "ొ": "o", "ో": "o", "ౌ": "au" };
const VIRAMA = "్";
const SIGNS = { "ం": "m", "ః": "h", "ఁ": "n" };
export const TELUGU = /[ఀ-౿]/;

export function toLatin(s = "") {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (CONS[ch] !== undefined) {
      out += CONS[ch];
      let nxt = s[i + 1] || "";
      if (MATRAS[nxt] !== undefined) { out += MATRAS[nxt]; i++; continue; }
      if (nxt === VIRAMA) { i++; continue; }
      if (nxt === "఼") i++;
      out += "a";
    } else if (VOWELS[ch] !== undefined) out += VOWELS[ch];
    else if (SIGNS[ch] !== undefined) out += SIGNS[ch];
    else if (ch >= "౦" && ch <= "౯") out += String(ch.charCodeAt(0) - 0x0C66);
    else if (MATRAS[ch] !== undefined) out += MATRAS[ch];
    else if (ch === VIRAMA) out += "";
    else out += ch;
  }
  return out;
}

const cache = new Map();
export function readable(s) {
  if (!s) return "";
  const c = cache.get(s);
  if (c !== undefined) return c;
  let t = toLatin(s).replace(/aa/g, "a").replace(/ee\b/g, "i").replace(/m(?=[kgcjtdnszyrlvh])/g, "n");
  t = t.split(/(\s+)/).map((w) => (w.trim() ? w[0].toUpperCase() + w.slice(1) : w)).join("").trim();
  if (cache.size > 20000) cache.clear();
  cache.set(s, t);
  return t;
}

const REPS = [["naidu", "nayudu"], ["aiah", "aya"], ["iah", "ya"], ["ou", "au"], ["chh", "c"], ["ch", "c"], ["kh", "k"],
  ["gh", "g"], ["jh", "j"], ["th", "t"], ["dh", "d"], ["ph", "p"], ["bh", "b"], ["sh", "s"], ["aa", "a"], ["ee", "i"],
  ["ii", "i"], ["oo", "u"], ["uu", "u"], ["ow", "au"], ["w", "v"], ["z", "j"], ["q", "k"], ["x", "ks"], ["f", "p"]];

export function normLatin(s = "") {
  s = s.toLowerCase().replace(/[^a-z ]+/g, " ");
  for (const [a, b] of REPS) s = s.split(a).join(b);
  s = s.split("ru").join("ri");
  s = s.replace(/([^aeiou ])y\b/g, "$1i").replace(/m(?=[kgcjtdnszyrlvh])/g, "n").replace(/(?<=[aeiou])h\b/g, "");
  return s.replace(/(.)\1+/g, "$1");
}

// word-level memo: names repeat the same words, so 3 lakh names need only a few thousand conversions
const wordKeys = new Map();
function wordKey(w) {
  let k = wordKeys.get(w);
  if (k === undefined) {
    k = normLatin(TELUGU.test(w) ? toLatin(w) : w).replace(/ /g, "");
    wordKeys.set(w, k);
  }
  return k;
}

export function key(s = "") {
  // Telugu text is converted word by word; the word breaks are the same either way
  let out = "";
  for (const w of s.split(/\s+/)) if (w) out += wordKey(w);
  return out;
}

const HOUSE_PREFIX = /^\s*(h\s*\.?\s*no|d\s*\.?\s*no|door\s*no|house\s*no|plot\s*no|హెచ్\s*ఎన్\s*\S*|హెచ్ఎ\S*|ఏచ్\s*నం|ఎచ్\s*నం|ఇంటి\s*నం\S*|ప్లాట్\s*నం\S*|డోర్\s*నం\S*)\s*[.:\-]*\s*/i;
export const houseKey = (h = "") => h.replace(HOUSE_PREFIX, "").toUpperCase().replace(/[^0-9A-Zఀ-౿]+/g, "-").replace(/^-+|-+$/g, "");
export const squashQuery = (q = "") => q.toUpperCase().replace(/[^0-9A-Zఀ-౿]+/g, "-").replace(/^-+|-+$/g, "");
