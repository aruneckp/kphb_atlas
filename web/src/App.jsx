import React, { Suspense, lazy, useEffect } from "react";
import { useApi } from "./lib/api.js";
import { link, useRoute } from "./lib/route.js";
import { num } from "./lib/format.js";
import FilterBar from "./components/FilterBar.jsx";
import { ErrorBox, Loading } from "./components/ui.jsx";
import Overview from "./pages/Overview.jsx";
import Search from "./pages/Search.jsx";
import Stations from "./pages/Stations.jsx";
import Station from "./pages/Station.jsx";
import Areas from "./pages/Areas.jsx";
import Families from "./pages/Families.jsx";
import Family from "./pages/Family.jsx";
import Households from "./pages/Households.jsx";
import Household from "./pages/Household.jsx";
import Voter from "./pages/Voter.jsx";
import Quality from "./pages/Quality.jsx";

const MapPage = lazy(() => import("./pages/MapPage.jsx"));
const Drill = lazy(() => import("./pages/Drill.jsx"));

// The navigation is drawn as a metro line: each page is a station on the Red Line.
const NAV = [
  ["/", "Overview"],
  ["/search", "Find voters"],
  ["/stations", "Polling stations"],
  ["/areas", "Areas"],
  ["/families", "Families"],
  ["/households", "Households"],
  ["/map", "Map"],
  ["/quality", "Data checks"],
];

const section = (parts) => {
  const p = parts[0] || "";
  if (p === "voter") return "/search";
  if (p === "station" || p === "stations") return "/stations";
  if (p === "family") return "/families";
  if (p === "household") return "/households";
  if (p === "drill") return "/";
  return `/${p}`;
};

export default function App() {
  const route = useRoute();
  const { data: meta, error } = useApi("/api/meta");
  const here = section(route.parts);
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);
  useEffect(() => { document.querySelector(".stop.on")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [here]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <a href="#/" className="logo" aria-label="Overview">
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 21h26" stroke="var(--metro)" strokeWidth="3" strokeLinecap="round" /><circle cx="16" cy="21" r="5" fill="var(--top-ink)" stroke="var(--metro)" strokeWidth="3" /><path d="M6 6h5v9H6zM13 4h6v11h-6zM21 8h5v7h-5z" fill="var(--block)" /></svg>
          </a>
          <div>
            <h1>Kukatpally voter atlas</h1>
            <p>{meta ? <>AC {meta.ac_no} · {num(meta.voters)} voters in {meta.stations.length} polling stations · draft roll 2026</> : "Assembly constituency 46"}</p>
          </div>
        </div>
        <nav className="line" aria-label="Pages">
          <span className="track" aria-hidden="true" />
          {NAV.map(([path, label]) => (
            <a key={path} href={link(path, route.params)} className={here === path ? "stop on" : "stop"} aria-current={here === path ? "page" : undefined}>
              <i aria-hidden="true" /><span>{label}</span>
            </a>
          ))}
        </nav>
      </header>

      {meta && <FilterBar route={route} meta={meta} />}

      <main>
        {error && <ErrorBox error={error} />}
        {!meta && !error && <Loading label="Opening the roll" />}
        {meta && <Page route={route} meta={meta} />}
      </main>
      <footer className="foot">
        Source: {meta?.source} · built {meta?.built}. Families and households are worked out from the relative's name and door number printed on the roll, so treat them as a guide. Voter details are personal data: keep this app private.
      </footer>
    </div>
  );
}

function Page({ route, meta }) {
  const [a, b] = route.parts;
  const props = { route, meta, params: route.params };
  switch (a) {
    case undefined: return <Overview {...props} />;
    case "search": return <Search {...props} />;
    case "stations": return b ? <Station {...props} part={+b} /> : <Stations {...props} />;
    case "areas": return <Areas {...props} />;
    case "families": return <Families {...props} />;
    case "family": return <Family {...props} id={+b} />;
    case "households": return <Households {...props} />;
    case "household": return <Household {...props} id={+b} />;
    case "voter": return <Voter {...props} id={+b} />;
    case "map": return <Suspense fallback={<Loading label="Loading map" />}><MapPage {...props} /></Suspense>;
    case "quality": return <Quality {...props} />;
    case "drill": return <Suspense fallback={<Loading label="Opening drill-down" />}><Drill {...props} /></Suspense>;
    default: return <div className="empty">This page does not exist. <a href="#/">Go to the overview</a>.</div>;
  }
}
