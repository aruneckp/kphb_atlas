// Family tree helpers. Each voter names one relative (father, mother or husband),
// so a family is a tree. A "unit" is a man (or a relative not on the roll) with the
// wives who name him; children hang below the unit.

export function makeFamily(payload) {
  const people = new Map();
  for (const m of payload.members) {
    people.set(String(m.id), {
      ...m, id: String(m.id),
      link: m.link_to ? { to: String(m.link_to), type: m.rel_type || "Other" } : null,
    });
  }
  for (const g of payload.ghosts) people.set(g.id, { ...g, ghost: true, link: null, gender: g.gender });
  // a link to someone outside this family (should not happen) is ignored
  for (const p of people.values()) if (p.link && !people.has(p.link.to)) p.link = null;
  return people;
}

const unitOf = (P, id) => {
  const l = P.get(id)?.link;
  return l && l.type === "Husband" ? l.to : id;
};
const parentUnit = (P, u) => {
  const l = P.get(u)?.link;
  return l && l.type !== "Husband" ? unitOf(P, l.to) : null;
};
const lineage = (P, u) => {
  const out = [];
  for (let x = u; x && out.length < 12 && !out.includes(x); x = parentUnit(P, x)) out.push(x);
  return out;
};
const word = (g, male, female, either) => (g === "M" ? male : g === "F" ? female : either);

// How `id` is related to `focus`, in plain words.
export function relationTo(P, focus, id) {
  if (focus === id) return "This voter";
  const uf = unitOf(P, focus), um = unitOf(P, id);
  const up = lineage(P, uf), down = lineage(P, um);
  const a = up.findIndex((u) => down.includes(u));
  if (a < 0) return "Relative";
  const b = down.indexOf(up[a]);
  const fWife = uf !== focus, mWife = um !== id;
  const g = P.get(id).gender;
  if (a === 0 && b === 0) return fWife && mWife ? "Co-wife" : mWife ? "Wife" : "Husband";
  if (b === 0) {
    if (fWife) return a === 1 ? word(g, "Father-in-law", "Mother-in-law", "Parent-in-law") : "Husband's grandparent";
    return a === 1 ? word(g, "Father", "Mother", "Parent") : a === 2 ? word(g, "Grandfather", "Grandmother", "Grandparent") : "Ancestor";
  }
  if (a === 0) {
    if (mWife) return b === 1 ? "Daughter-in-law" : "Grandson's wife";
    return b === 1 ? word(g, "Son", "Daughter", "Child") : b === 2 ? word(g, "Grandson", "Granddaughter", "Grandchild") : "Descendant";
  }
  if (a === 1 && b === 1) {
    if (mWife) return "Sister-in-law";
    return fWife ? word(g, "Brother-in-law", "Sister-in-law", "Sibling-in-law") : word(g, "Brother", "Sister", "Sibling");
  }
  if (a === 1 && b === 2) return mWife ? "Nephew's wife" : word(g, "Nephew", "Niece", "Nephew / niece");
  if (a === 2 && b === 1) return mWife ? "Aunt" : word(g, "Uncle", "Aunt", "Uncle / aunt");
  if (a === 2 && b === 2) return mWife ? "Cousin's wife" : "Cousin";
  return "Relative";
}

// Nested tree: [{ id, spouses: [id], children: [node] }]
export function familyTree(P) {
  const ids = [...P.keys()];
  const wives = new Map(), kids = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const id of ids) {
    const l = P.get(id).link;
    if (l) push(l.type === "Husband" ? wives : kids, l.to, id);
  }
  const age = (id) => P.get(id).age ?? 999;
  const seen = new Set();
  const node = (id) => {
    seen.add(id);
    const spouses = (wives.get(id) || []).filter((s) => !seen.has(s));
    spouses.forEach((s) => seen.add(s));
    const children = [id, ...spouses].flatMap((p) => kids.get(p) || [])
      .filter((k, i, a) => a.indexOf(k) === i && !seen.has(k))
      .sort((x, y) => age(y) - age(x));
    children.forEach((k) => seen.add(k));
    return { id, spouses, children: children.map(node) };
  };
  const roots = ids.filter((id) => !P.get(id).link)
    .sort((x, y) => (P.get(x).ghost ? 0 : 1) - (P.get(y).ghost ? 0 : 1) || age(y) - age(x));
  const out = roots.map(node);
  for (const id of ids) if (!seen.has(id)) out.push(node(id));
  return out;
}
