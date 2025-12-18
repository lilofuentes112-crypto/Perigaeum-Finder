// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto + Chiron: pro rückläufiger Phase genau 1 Perigäum (Distanzminimum)
// Robust gegen Stationen: Retro-Erkennung mit Hysterese (keine Fenster-Zerhackung)

import SwissEph from "swisseph-wasm";

const BODIES = [
  { id: "SE_SUN",     name: "Sonne",   mode: "SUN"   },
  { id: "SE_MERCURY", name: "Merkur",  mode: "RETRO" },
  { id: "SE_VENUS",   name: "Venus",   mode: "RETRO" },
  { id: "SE_MARS",    name: "Mars",    mode: "RETRO" },
  { id: "SE_JUPITER", name: "Jupiter", mode: "RETRO" },
  { id: "SE_SATURN",  name: "Saturn",  mode: "RETRO" },
  { id: "SE_CHIRON",  name: "Chiron",  mode: "RETRO" },
  { id: "SE_URANUS",  name: "Uranus",  mode: "RETRO" },
  { id: "SE_NEPTUNE", name: "Neptun",  mode: "RETRO" },
  { id: "SE_PLUTO",   name: "Pluto",   mode: "RETRO" }
];

// ---------------- CORS ----------------
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// --------------- Datum helpers (UTC) ---------------
// WICHTIG: Datum aus Swiss Ephemeris revjul() (robust an Jahres-/Tagesgrenzen)
function makeDateFormatter(swe) {
  return function formatJdAsDE(jd) {
    // revjul liefert: [year, month, day, hour]
    const r = swe.revjul(jd, swe.SE_GREG_CAL);
    const year = r[0];
    const month = r[1];
    const day = r[2];
    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${dd}.${mm}.${year}`;
  };
}

// ---------------- Math helpers ----------------
function normDeltaDeg(d) {
  // auf [-180, +180] normalisieren (robust über 0°/360°)
  let x = ((d + 540) % 360) - 180;
  if (x === -180) x = 180;
  return x;
}

// Golden section minimum
function goldenMin(f, a, b, tolDays) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b -
