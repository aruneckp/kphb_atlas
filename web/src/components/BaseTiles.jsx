import React from "react";
import { TileLayer } from "react-leaflet";
import { useApi } from "../lib/api.js";

// Background street map. The server decides the provider (OpenStreetMap by default, no API key);
// in dark mode the light OpenStreetMap tiles are darkened with a CSS filter.
export default function BaseTiles() {
  const { data: meta } = useApi("/api/meta");
  const t = meta?.tiles || { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", dark: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors", invert_dark: true };
  const dark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return (
    <TileLayer key={dark ? t.dark : t.url} url={dark ? t.dark : t.url} attribution={t.attribution} maxZoom={19}
      className={dark && t.invert_dark ? "tiles-dark" : ""} />
  );
}
