// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto + Chiron: pro rückläufiger Phase genau 1 Distanzminimum
// Rückläufigkeit wird direkt aus Swiss Ephemeris SPEED bestimmt (pos[3])

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

// ---------------- Golden section minimum ----------------
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

  const left  = Math.max(a, bestJd - 0.75);
  const right = Math.min(b, bestJd + 0.75);
  const tol = 1 / 1440; // 1 Minute
  return goldenMin(getDist, left, right, tol);
}

// ---------------- SwissEph access ----------------
function makeCalc(swe, bodyId) {
  // WICHTIG: mit SPEED, damit wir Retro sauber erkennen können
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  return {
    getDist(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[2]; // AU
    },
    getSpeedLon(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[3]; // deg/day (ekl. Länge)
    }
  };
}

// Retro-Fenster über SPEED (robust um Stationen):
// - retro wenn speedLon < -eps
// - direkt wenn speedLon > +eps
// - |speedLon| <= eps = Station/neutral -> zählt nicht als Umschalten
function findRetroWindowsBySpeed(getSpeedLon, jdStart, jdEnd) {
  const step = 0.125; // 3h
  const need = 3;     // 3 Schritte ~ 9h Stabilität

  // eps in deg/day: sehr klein, aber nicht 0 (Stationen)
  // 1e-5 deg/day ~ 0.036" pro Tag (extrem klein) -> konservativ
  const eps = 1e-5;

  const windows = [];
  let inRetro = false;
  let startJd = null;

  let retroStreak = 0;
  let directStreak = 0;

  for (let jd = jdStart; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const v = getSpeedLon(curJd);

    // Station/neutral: nicht als Richtungswechsel zählen
    if (Math.abs(v) <= eps) {
      if (curJd >= jdEnd) break;
      continue;
    }

    const isRetro = v < 0;

    if (isRetro) {
      retroStreak++;
      directStreak = 0;
    } else {
      directStreak++;
      retroStreak = 0;
    }

    if (!inRetro && retroStreak >= need) {
      inRetro = true;
      startJd = curJd - step * (need + 1);
      if (startJd < jdStart) startJd = jdStart;
    }

    if (inRetro && directStreak >= need) {
      inRetro = false;
      windows.push([startJd, curJd]);
      startJd = null;
    }

    if (curJd >= jdEnd) break;
  }

  if (inRetro && startJd != null) {
    windows.push([startJd, jdEnd]);
  }

  return windows.filter(([a, b]) => (b - a) > 1.0);
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

    await swe.initSwissEph();

    // Exakt das Kalenderjahr (UTC)
    const jdYearStart = swe.julday(year, 1, 1, 0.0);
    const jdYearEnd   = swe.julday(year + 1, 1, 1, 0.0);

    // Puffer über Jahreswechsel
    const pad = 20; // etwas größer als 7, damit Stationen nicht "abgeschnitten" werden
    const jdCalcStart = jdYearStart - pad;
    const jdCalcEnd   = jdYearEnd + pad;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist, getSpeedLon } = makeCalc(swe, bodyId);

      let perigees = [];

      if (body.mode === "SUN") {
        const jdMin = minDistanceInWindow(getDist, jdYearStart, jdYearEnd);
        const cal = jdToCalendar(jdMin);
        perigees = [{ datum: formatDateDE(cal) }];
      } else {
        // Retrofenster über SPEED
        const windows = findRetroWindowsBySpeed(getSpeedLon, jdCalcStart, jdCalcEnd);

        for (const [a0, b0] of windows) {
          const jdMin = minDistanceInWindow(getDist, a0, b0);

          // Ausgabe nur wenn Ereignis im Kalenderjahr liegt
          if (jdMin >= jdYearStart && jdMin < jdYearEnd) {
            const cal = jdToCalendar(jdMin);
            perigees.push({ datum: formatDateDE(cal) });
          }
        }

        // Duplikate entfernen (Tag-Rundung)
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
    try { swe.close(); } catch (_) {}
  }
}

