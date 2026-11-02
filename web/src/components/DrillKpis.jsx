import React from "react";
import { num, pct, ratio } from "../lib/format.js";
import { drill } from "../lib/drill.js";
import { Kpis } from "./ui.jsx";

// Headline numbers; each one opens the drill-down for that group.
export default function DrillKpis({ t, params, fam }) {
  const multi = fam ? fam.filter((r) => r.size >= 2).reduce((s, r) => s + r.families, 0) : t.families;
  return (
    <Kpis items={[
      { label: "Voters", value: t.voters, sub: `${num(t.stations)} polling stations`, href: drill(params) },
      { label: "Women per 1,000 men", value: ratio(t.female, t.male), sub: `${num(t.female)} women · ${num(t.male)} men`, href: drill(params, { gender: "F" }) },
      { label: "Average age", value: t.avg_age ?? "–", sub: `${pct(t.youth, t.voters)} are 18–29`, href: drill(params, { age_min: 18, age_max: 29 }) },
      { label: "First-time voters", value: t.first_time, sub: "aged 18–19", tone: "sun", href: drill(params, { age_min: 18, age_max: 19 }) },
      { label: "Aged 60 and over", value: t.senior, sub: `${num(t.over80)} are 80+`, href: drill(params, { age_min: 60, age_max: "" }) },
      { label: "Families of 2+ voters", value: multi, sub: `${pct(t.linked, t.voters)} linked to a relative`, href: drill(params, { linked: 1 }) },
      { label: "Door numbers", value: t.households, sub: `${(t.voters / (t.households || 1)).toFixed(1)} voters per door`, href: drill(params, { hh_size: "10+" }) },
      { label: "Entries to check", value: t.review, sub: "OCR or roll doubts", tone: "warn", href: drill(params, { review: 1 }) },
    ]} />
  );
}

