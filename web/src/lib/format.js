const nf = new Intl.NumberFormat("en-IN");
export const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? "–" : nf.format(n));
export const pct = (a, b, d = 1) => (b ? `${((100 * a) / b).toFixed(d)}%` : "–");
export const ratio = (f, m) => (m ? Math.round((1000 * f) / m) : "–"); // women per 1,000 men
export const genderWord = (g) => ({ M: "Male", F: "Female", T: "Third gender" }[g] || "Not read");
export const relWord = (r) => ({ Father: "Father", Husband: "Husband", Mother: "Mother", Other: "Other relative" }[r] || "Relative");
export const linkWord = (h) => ({
  "same house": "Matched in the same house",
  "similar name in house": "Similar spelling, same house",
  "same building": "Similar spelling, same building",
  "same name in station": "Same name in this polling station",
  "not on roll": "Relative is not on the roll",
}[h] || "No relative named");
