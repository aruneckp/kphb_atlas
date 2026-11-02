import React from "react";
import { useApi } from "../lib/api.js";
import { link } from "../lib/route.js";
import { genderWord, linkWord } from "../lib/format.js";
import FamilyTree from "../components/FamilyTree.jsx";
import { ErrorBox, Loading, Panel, VoterTable } from "../components/ui.jsx";

const Field = ({ label, children, te }) => (
  <div className="field"><dt>{label}</dt><dd lang={te ? "te" : undefined}>{children || "–"}</dd></div>
);

export default function Voter({ params, id }) {
  const { data: v, error } = useApi(`/api/voter/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!v) return <Loading />;
  const fam = v.family;
  return (
    <div className="page">
      <div className="crumbs">
        <a href={link("/search", params)}>Find voters</a><span>·</span>
        <a href={link(`/stations/${v.part_no}`, params)}>PS {v.part_no} · {v.locality}</a>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      </div>
      <div className="voter-head">
        <div className="slip">
          <span className="slip-ps">PS {v.part_no}</span>
          <span className="slip-sl">Serial {v.serial_no}</span>
        </div>
        <div>
          <h2 lang="te">{v.name || "Name not read"}</h2>
          <p className="en">{v.name_en}</p>
          <p className="tags"><span>{genderWord(v.gender)}</span><span>Age {v.age ?? "not read"}</span><span>{v.epic || "No voter ID read"}</span>
            {v.status === "Deleted" && <span className="warn">Marked deleted{v.deletion_code ? `: ${v.deletion_code}` : ""}</span>}</p>
        </div>
      </div>
      {v.needs_review ? <p className="callout warn">This entry needs checking against the printed roll: {v.review_reason}{v.ocr_conf ? ` (reading confidence ${v.ocr_conf}%)` : ""}.</p> : null}
      {(v.epic_dup || v.name_dup) && <p className="callout">Possible duplicate: {v.epic_dup || v.name_dup}</p>}
      <div className="cols-2">
        <Panel title="Roll details">
          <dl className="fields">
            <Field label={v.rel_type ? `${v.rel_type}'s name` : "Relative's name"} te>{v.rel_name}</Field>
            <Field label="In English letters">{v.rel_name_en}</Field>
            <Field label="House no.">{v.house}</Field>
            <Field label="Section" te>{v.section_no ? `${v.section_no} · ${v.section_name || ""}` : ""}</Field>
            <Field label="Polling station" te>{v.station_name}</Field>
            <Field label="Station address" te>{v.station_address}</Field>
            <Field label="Area">{v.locality} · {v.police_en} PS · {v.mandal_en} mandal · {v.pin}</Field>
            <Field label="Roll page">{v.page_no}</Field>
          </dl>
        </Panel>
        <Panel title="Relative on the roll" note={linkWord(v.link_how)}>
          {v.linked ? (v.linked.ghost ? (
            <p><span lang="te">{v.linked.name}</span> ({v.linked.name_en}) is named as {v.rel_type?.toLowerCase() || "relative"} but is not a voter in this station.</p>
          ) : <VoterTable rows={[v.linked]} params={params} />) : <p>No relative is named for this voter.</p>}
          {fam && <p className="more"><a href={link(`/family/${fam.family.id}`, params, { focus: v.id })}>Open the family ({fam.family.size} voters)</a></p>}
        </Panel>
      </div>
      {fam && fam.members.length + fam.ghosts.length > 1 && (
        <Panel title="Family tree" note="The highlighted card is this voter. Labels show how each person is related to them.">
          <FamilyTree payload={fam} focus={v.id} params={params} />
        </Panel>
      )}
      {v.household.length > 1 && (
        <Panel title={`Everyone at door ${v.house}`} note={`${v.household.length} voters share this door number in PS ${v.part_no}.`}>
          <VoterTable rows={v.household} params={params} showStation={false} focus={v.id} />
        </Panel>
      )}
    </div>
  );
}
