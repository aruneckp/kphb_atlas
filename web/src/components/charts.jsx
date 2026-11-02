import React, { useRef, useState } from "react";
import { num, pct } from "../lib/format.js";

// Shared hover tooltip, positioned inside the chart's own box.
function useTip() {
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, content });
  };
  const hide = () => setTip(null);
  const el = tip && (
    <div className="tip" role="status"
      style={{ left: Math.min(Math.max(tip.x, 90), tip.w - 90), top: tip.y }}>
      {tip.content}
    </div>
  );
  return { box, show, hide, el };
}

// Horizontal bars with labels on the left. items: [{key,label,sub,value,href}]
export function HBars({ items, total, unit = "voters", max, onPick, color = "var(--series-seq)", limit }) {
  const t = useTip();
  const list = limit ? items.slice(0, limit) : items;
  const top = max ?? Math.max(1, ...list.map((i) => i.value));
  const sum = total ?? items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="hbars" ref={t.box} onMouseLeave={t.hide}>
      {list.map((i) => {
        const Row = i.href ? "a" : onPick ? "button" : "div";
        return (
          <Row key={i.key ?? i.label} className="hbar" href={i.href} type={Row === "button" ? "button" : undefined}
            onClick={onPick ? () => onPick(i) : undefined}
            onMouseMove={(e) => t.show(e, <><b>{i.label}</b><span>{num(i.value)} {unit} · {pct(i.value, sum)}</span>{i.tip}{(i.href || onPick) && <em>Click to drill down</em>}</>)}>
            <span className="hbar-label">{i.label}{i.sub && <small>{i.sub}</small>}</span>
            <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(100 * i.value) / top}%`, background: i.color || color }} /></span>
            <span className="hbar-value">{num(i.value)}</span>
          </Row>
        );
      })}
      {t.el}
    </div>
  );
}

// Age pyramid: men to the left, women to the right. hrefFor(band, gender) makes each bar a drill-down link.
export function Pyramid({ rows, hrefFor }) {
  const t = useTip();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.male, r.female)));
  const total = rows.reduce((s, r) => s + r.male + r.female + (r.other || 0), 0);
  const data = [...rows].filter((r) => r.band !== "unknown").reverse();
  const Side = ({ r, g }) => {
    const v = g === "M" ? r.male : r.female;
    const bar = <span className={`pyr-bar ${g === "M" ? "m" : "f"}`} style={{ width: `${(100 * v) / max}%` }} />;
    const tip = (e) => t.show(e, <><b>{g === "M" ? "Men" : "Women"} aged {r.band}</b><span>{num(v)} voters · {pct(v, total)} of all</span>{hrefFor && <em>Click to drill down</em>}</>);
    const cls = `pyr-side ${g === "M" ? "left" : "right"}`;
    return hrefFor
      ? <a className={cls} href={hrefFor(r.band, g)} onMouseMove={tip} aria-label={`${g === "M" ? "Men" : "Women"} aged ${r.band}: ${v}`}>{bar}</a>
      : <span className={cls} onMouseMove={tip}>{bar}</span>;
  };
  return (
    <div className={`pyramid ${hrefFor ? "drillable" : ""}`} ref={t.box} onMouseLeave={t.hide}>
      <div className="pyr-legend"><span><i className="sw sw-m" />Men</span><span><i className="sw sw-f" />Women</span></div>
      {data.map((r) => (
        <div className="pyr-row" key={r.band}>
          <Side r={r} g="M" />
          {hrefFor ? <a className="pyr-band" href={hrefFor(r.band, "")} title={`Everyone aged ${r.band}`}>{r.band}</a> : <span className="pyr-band">{r.band}</span>}
          <Side r={r} g="F" />
        </div>
      ))}
      {t.el}
    </div>
  );
}

// Vertical columns on a shared baseline. items: [{label, value}]
export function Columns({ items, unit, caption }) {
  // items may carry href to drill down
  const t = useTip();
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <figure className="columns" ref={t.box} onMouseLeave={t.hide}>
      <div className="col-plot">
        {items.map((i) => {
          const C = i.href ? "a" : "div";
          return (
            <C key={i.label} className={i.href ? "col drill" : "col"} href={i.href}
              onMouseMove={(e) => t.show(e, <><b>{i.label}</b><span>{num(i.value)} {unit} · {pct(i.value, total)}</span>{i.href && <em>Click to drill down</em>}</>)}>
              <span className="col-bar" style={{ height: `${Math.max(1, (100 * i.value) / max)}%` }} />
              <span className="col-label">{i.label}</span>
            </C>
          );
        })}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
      {t.el}
    </figure>
  );
}

// One 100% bar for men / women / third gender, direct-labelled.
export function GenderBar({ male = 0, female = 0, third = 0, hrefFor }) {
  const tot = male + female + third || 1;
  const Seg = ({ g, cls, w }) => hrefFor
    ? <a className={cls} href={hrefFor(g)} style={{ width: w }} title={`Drill into ${{ M: "men", F: "women", T: "third gender" }[g]}`} />
    : <span className={cls} style={{ width: w }} />;
  const Leg = ({ g, children }) => hrefFor ? <a href={hrefFor(g)}>{children}</a> : <span>{children}</span>;
  return (
    <div className="gbar" aria-label={`${num(male)} men, ${num(female)} women, ${num(third)} third gender`}>
      <div className="gbar-track">
        <Seg g="M" cls="gbar-m" w={`${(100 * male) / tot}%`} />
        <Seg g="F" cls="gbar-f" w={`${(100 * female) / tot}%`} />
        {third > 0 && <Seg g="T" cls="gbar-t" w={`${Math.max(0.6, (100 * third) / tot)}%`} />}
      </div>
      <div className="gbar-legend">
        <Leg g="M"><i className="sw sw-m" />Men {num(male)} · {pct(male, tot)}</Leg>
        <Leg g="F"><i className="sw sw-f" />Women {num(female)} · {pct(female, tot)}</Leg>
        {third > 0 && <Leg g="T"><i className="sw sw-t" />Third gender {num(third)}</Leg>}
      </div>
    </div>
  );
}

// Thin inline bar for tables
export const Meter = ({ value, max, tone }) => (
  <span className={`meter ${tone || ""}`}><span style={{ width: `${Math.min(100, (100 * value) / (max || 1))}%` }} /></span>
);
