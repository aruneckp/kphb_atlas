import React, { useMemo } from "react";
import { familyTree, makeFamily, relationTo } from "../lib/kin.js";
import { link } from "../lib/route.js";

function Person({ p, P, focus, params }) {
  const rel = focus && P.has(String(focus)) ? relationTo(P, String(focus), p.id) : null;
  const body = (
    <>
      <span className="pc-name" lang="te">{p.name || "Name not read"}</span>
      <span className="pc-en">{p.name_en}</span>
      <span className="pc-meta">
        {p.ghost ? "Not on the roll" : <>{p.gender === "F" ? "F" : p.gender === "M" ? "M" : "?"}{p.age ? `, ${p.age}` : ""} · PS {p.part_no}/{p.serial_no}</>}
      </span>
      {rel && <span className="pc-rel">{rel}</span>}
    </>
  );
  const cls = `pcard ${p.ghost ? "ghost" : ""} g-${p.gender || "x"} ${String(focus) === p.id ? "focus" : ""}`;
  return p.ghost ? <div className={cls}>{body}</div> : <a className={cls} href={link(`/voter/${p.id}`, params)}>{body}</a>;
}

function Node({ n, P, focus, params }) {
  return (
    <li>
      <div className="couple">
        <Person p={P.get(n.id)} P={P} focus={focus} params={params} />
        {n.spouses.map((s) => (
          <React.Fragment key={s}><span className="plus" aria-hidden="true">+</span><Person p={P.get(s)} P={P} focus={focus} params={params} /></React.Fragment>
        ))}
      </div>
      {n.children.length > 0 && (
        <ul>{n.children.map((c) => <Node key={c.id} n={c} P={P} focus={focus} params={params} />)}</ul>
      )}
    </li>
  );
}

export default function FamilyTree({ payload, focus, params }) {
  const P = useMemo(() => makeFamily(payload), [payload]);
  const roots = useMemo(() => familyTree(P), [P]);
  return (
    <div className="ftree-wrap">
      <ul className="ftree">{roots.map((r) => <Node key={r.id} n={r} P={P} focus={focus} params={params} />)}</ul>
    </div>
  );
}
