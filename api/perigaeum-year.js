// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel (Minimum der Sonnen-Distanz) im Jahr (kein Retro-Filter)
// - Merkur–Pluto + Chiron: Perigäum = Distanz-Minimum innerhalb JEDER rückläufigen Phase
//   (damit kann es keine "Perigäen" außerhalb der Rückläufigkeit geben)
//
// Robust: Retro-Phasen werden OHNE SEFLG_SPEED ermittelt (sonst kann swisseph-wasm "memory access out of bounds" werfen)

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
function jdToCalendar(jd) {
  const Z = Math.floor(jd + 0.5);
  const F = jd + 0.5 - Z;

  let A = Z;
  if (Z >= 2299161) {
    const alpha = Math.floor((Z - 1867216.25) / 36524.25);
    A = Z + 1 + alpha - Math.floor(alpha / 4);
  }

  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C);
  const E = Math.floor((B - D) / 30.6001);

  const dayFloat = B - D - Math.floor(30.6001 * E) + F;
  const day = Math.floor(dayFloat + 1e-6);

  const month = (E < 14) ? (E - 1) : (E - 13);
  const year = (month > 2) ? (C - 4716) : (C - 4715);

  return { year, month, day };
}

function formatDateDE({ year, month, day }) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

// ---------------- Math helpers ----------------
function normDeltaDeg(d) {
  // auf [-180, +180] normalisieren
  let x = ((d + 540) % 360) - 180;
  if (x === -180) x = 180;
  return x;
}

// Golden section minimum (sparsam: wenige Iterationen)
function goldenMin(f, a, b, tolDays) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);

  for (let it = 0; it < 60; it++) {
    if ((b - a) <= tolDays) break;
    if (fd < fc) {
      a = c; c = d; fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    } else {
      b = d; d = c; fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    }
  }
  return (a + b) / 2;
}

// Distanz-Minimum in [a,b] finden (coarse + refine)
function minDistanceInWindow(getDist, a, b) {
  const coarseStep = 0.25; // 6h
  let bestJd = a;
  let bestD = getDist(a);

  for (let jd = a; jd <= b + 1e-9; jd += coarseStep) {
    const j = Math.min(jd, b);
    const d = getDist(j);
    if (d < bestD) {
      bestD = d;
      bestJd = j;
    }
  }

  const left = Math.max(a, bestJd - 0.75);   // 18h links
  const right = Math.min(b, bestJd + 0.75);  // 18h rechts
  const tol = 1 / 1440; // 1 Minute

  return goldenMin(getDist, left, right, tol);
}

// ---------------- SwissEph access ----------------
function makeCalc(swe, bodyId) {
  const flags = swe.SEFLG_SWIEPH; // WICHTIG: kein SEFLG_SPEED (WASM kann sonst crashen)

  function getDist(jd) {
    const pos = swe.calc_ut(jd, bodyId, flags);
    return pos[2]; // AU
  }

  function getLon(jd) {
    const pos = swe.calc_ut(jd, bodyId, flags);
    return pos[0]; // ekl. Länge (deg)
  }

  return { getDist, getLon };
}

// Retro-Fenster über ΔLänge (ohne SPEED) bestimmen.
// Retro, wenn die normalisierte Differenz zwischen zwei Zeitpunkten negativ ist.
function findRetroWindows(getLon, jdStart, jdEnd) {
  const step = 0.125; // 3h (stabil, aber nicht zu viele Calls)
  const windows = [];

  let prevJd = jdStart;
  let prevLon = getLon(prevJd);

  let inRetro = false;
  let startJd = null;

  for (let jd = jdStart + step; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const curLon = getLon(curJd);

    const dLon = normDeltaDeg(curLon - prevLon);
    const isRetroStep = dLon < 0;

    // Eintritt
    if (!inRetro && isRetroStep) {
      inRetro = true;
      startJd = prevJd; // Start am vorherigen Stützpunkt (genug, weil wir am Ende auf Tag runden)
    }

    // Austritt
    if (inRetro && !isRetroStep) {
      inRetro = false;
      windows.push([startJd, curJd]);
      startJd = null;
    }

    prevJd = curJd;
    prevLon = curLon;

    if (curJd >= jdEnd) break;
  }

  if (inRetro && startJd != null) {
    windows.push([startJd, jdEnd]);
  }

  // sehr kurze Artefakte raus
  return windows.filter(([a, b]) => (b - a) > (6 / 24)); // > 6h
}

// ---------------- Handler ----------------
export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const swe = new SwissEph();

  try {
    const yearParam =
      (req.method === "GET" ? req.query.year : req.body?.year) ?? "";
    const year = parseInt(yearParam, 10);

    if (!Number.isFinite(year) || year < 1900 || year > 2050) {
      return res.status(400).json({
        ok: false,
        error: "Bitte ein Jahr zwischen 1900 und 2050 angeben."
      });
    }

    await swe.initSwissEph();

    // Jahresbereich (UTC)
    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0); // leicht überlappend

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist, getLon } = makeCalc(swe, bodyId);

      let perigees = [];

      if (body.mode === "SUN") {
        // Sonne: Erd-Perihel = Distanzminimum im Jahr
        const jdMin = minDistanceInWindow(getDist, jdStart, jdEnd);
        perigees = [{ datum: formatDateDE(jdToCalendar(jdMin)) }];
      } else {
        // Planeten/Chiron: Perigäum pro rückläufigem Fenster
        const windows = findRetroWindows(getLon, jdStart, jdEnd);

        for (const [a, b] of windows) {
          const jdMin = minDistanceInWindow(getDist, a, b);
          perigees.push({ datum: formatDateDE(jdToCalendar(jdMin)) });
        }

        // Duplikate (durch Rundung auf Tag) entfernen
        const seen = new Set();
        perigees = perigees.filter((p) => {
          if (seen.has(p.datum)) return false;
          seen.add(p.datum);
          return true;
        });
      }

      if (perigees.length === 0) {
        results.push({ body: body.name, perigees: [], info: "Kein Perigäum in diesem Jahr" });
      } else {
        totalCount += perigees.length;
        results.push({ body: body.name, perigees, info: null });
      }
    }

    return res.status(200).json({
      ok: true,
      year,
      totalCount,
      bodies: results
    });
  } catch (e) {
    console.error("Perigäum-Fehler:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  } finally {
    try { swe.close(); } catch (_) {}
  }
}
