// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto + Chiron: Perigäen = lokale Minima der geozentrischen Distanz im Kalenderjahr
// (ohne Retro-Filter, weil Perigäum eine Distanz-Eigenschaft ist und Retro-Filter bei Chiron/Jupiter oft "0 Treffer" ergibt)

import SwissEph from "swisseph-wasm";
import path from "path";

// Falls Vercel/Next irrtümlich Edge nimmt: erzwinge Node (schadet sonst nicht)
export const config = { runtime: "nodejs" };

const BODIES = [
  { id: "SE_SUN",     name: "Sonne",   mode: "SUN"   },
  { id: "SE_MERCURY", name: "Merkur",  mode: "MINIMA" },
  { id: "SE_VENUS",   name: "Venus",   mode: "MINIMA" },
  { id: "SE_MARS",    name: "Mars",    mode: "MINIMA" },
  { id: "SE_JUPITER", name: "Jupiter", mode: "MINIMA" },
  { id: "SE_SATURN",  name: "Saturn",  mode: "MINIMA" },
  { id: "SE_CHIRON",  name: "Chiron",  mode: "MINIMA" },
  { id: "SE_URANUS",  name: "Uranus",  mode: "MINIMA" },
  { id: "SE_NEPTUNE", name: "Neptun",  mode: "MINIMA" },
  { id: "SE_PLUTO",   name: "Pluto",   mode: "MINIMA" }
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

// ---------------- Golden section minimum ----------------
function goldenMin(f, a, b, tolDays) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);

  for (let it = 0; it < 80; it++) {
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

  const left  = Math.max(a, bestJd - 2.0);
  const right = Math.min(b, bestJd + 2.0);
  const tol = 1 / 1440; // 1 Minute
  return goldenMin(getDist, left, right, tol);
}

// ---------------- SwissEph access ----------------
function makeCalc(swe, bodyId) {
  // geozentrische Distanz zur Erde (AU)
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  return {
    getDist(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[2]; // Distanz (AU)
    }
  };
}

// ----------- lokale Minima der Distanz finden -----------
function findLocalMinimaJds(getDist, jdStart, jdEnd) {
  // Schrittweite: 12h ist für alle Körper stabil genug und findet die Minima sicher,
  // danach wird ohnehin in einem Fenster verfeinert.
  const step = 0.5; // Tage (=12h)

  const candidates = [];
  let prevJd = jdStart;
  let prevD = getDist(prevJd);

  let curJd = Math.min(prevJd + step, jdEnd);
  let curD = getDist(curJd);

  for (let jd = curJd + step; jd <= jdEnd + 1e-9; jd += step) {
    const nextJd = Math.min(jd, jdEnd);
    const nextD = getDist(nextJd);

    // lokales Minimum: fällt und steigt wieder
    if (curD <= prevD && curD <= nextD) {
      // Kandidat um curJd herum verfeinern
      const a = Math.max(jdStart, curJd - 3.0);
      const b = Math.min(jdEnd,   curJd + 3.0);
      const jdMin = minDistanceInWindow(getDist, a, b);
      candidates.push(jdMin);
    }

    prevJd = curJd; prevD = curD;
    curJd = nextJd; curD = nextD;

    if (nextJd >= jdEnd) break;
  }

  // Duplikate zusammenziehen (wenn mehrere Kandidaten dasselbe Minimum erwischen)
  candidates.sort((a, b) => a - b);
  const merged = [];
  for (const jd of candidates) {
    if (merged.length === 0) {
      merged.push(jd);
    } else {
      const last = merged[merged.length - 1];
      if (Math.abs(jd - last) > 2.0) {
        merged.push(jd);
      }
    }
  }
  return merged;
}

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

    // 1) WASM initialisieren
    await swe.initSwissEph();

    if (typeof swe.calc_ut !== "function") {
      return res.status(500).json({
        ok: false,
        error: "SwissEph init fehlgeschlagen (calc_ut nicht verfügbar). Prüfe Vercel Runtime (Node, nicht Edge)."
      });
    }

    // 2) Ephemeridenpfad setzen – Ordner liegt unter api/ephe
    const ephePath = path.join(process.cwd(), "api", "ephe");
    if (typeof swe.set_ephe_path === "function") {
      swe.set_ephe_path(ephePath);
    } else if (typeof swe.swe_set_ephe_path === "function") {
      swe.swe_set_ephe_path(ephePath);
    } else {
      return res.status(500).json({
        ok: false,
        error: "SwissEph hat keine set_ephe_path/swe_set_ephe_path Methode. Paketversion prüfen."
      });
    }

    // Exakt das Kalenderjahr (UTC)
    const jdYearStart = swe.julday(year, 1, 1, 0.0, swe.SE_GREG_CAL);
    const jdYearEnd   = swe.julday(year + 1, 1, 1, 0.0, swe.SE_GREG_CAL);

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist } = makeCalc(swe, bodyId);

      let perigees = [];

      if (body.mode === "SUN") {
        // Sonne: Perihel (Minimum Distanz) im Kalenderjahr
        const jdMin = minDistanceInWindow(getDist, jdYearStart, jdYearEnd);
        perigees = [{ datum: formatDateDE(jdToCalendar(jdMin)) }];
      } else {
        // Alle anderen: lokale Minima der Distanz im Jahr
        const minimaJds = findLocalMinimaJds(getDist, jdYearStart, jdYearEnd);

        for (const jdMin of minimaJds) {
          if (jdMin >= jdYearStart && jdMin < jdYearEnd) {
            perigees.push({ datum: formatDateDE(jdToCalendar(jdMin)) });
          }
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
        results.push({
          body: body.name,
          perigees: [],
          info: "Kein Perigäum in diesem Jahr"
        });
      } else {
        totalCount += perigees.length;
        results.push({
          body: body.name,
          perigees,
          info: null
        });
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
    try { if (typeof swe.close === "function") swe.close(); } catch (_) {}
  }
}
