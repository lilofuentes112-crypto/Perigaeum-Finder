// api/perigaeum-year.js
// Jahres-Perigäum-Suche (Datum, deutsch)
// - Sonne: Erd-Perihel (Minimum der Sonnen-Distanz) im Jahr, ohne Retro-Filter
// - Merkur–Pluto + Chiron: Perigäum = Distanz-Minimum innerhalb JEDER rückläufigen Phase
//   (damit kann es keine „Perigäen“ außerhalb der Rückläufigkeit geben)

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

// --------------- Datum helpers ---------------
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

// --------------- Numerik helpers ---------------
// Bisection für Nullstelle von f(jd) im Intervall [a,b] (f(a) und f(b) haben unterschiedliches Vorzeichen)
function bisectZero(f, a, b, tolDays) {
  let fa = f(a);
  let fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return (a + b) / 2;
  if (fa === 0) return a;
  if (fb === 0) return b;

  // Sicherheitsnetz: falls doch kein Vorzeichenwechsel, gib Mitte zurück
  if ((fa > 0 && fb > 0) || (fa < 0 && fb < 0)) return (a + b) / 2;

  let left = a, right = b;
  for (let it = 0; it < 80; it++) {
    const mid = (left + right) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return mid;
    if ((right - left) <= tolDays) return mid;
    if ((fa > 0 && fm > 0) || (fa < 0 && fm < 0)) {
      left = mid;
      fa = fm;
    } else {
      right = mid;
      fb = fm;
    }
  }
  return (left + right) / 2;
}

// Golden-Section-Search (Minimum) auf [a,b]
function goldenMin(f, a, b, tolDays) {
  const gr = (Math.sqrt(5) - 1) / 2; // 0.618...
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);

  for (let it = 0; it < 120; it++) {
    if ((b - a) <= tolDays) break;
    if (fd < fc) {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    } else {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    }
  }
  return (a + b) / 2;
}

// --------------- SwissEph access ---------------
function makeCalc(swe, bodyId) {
  // SEFLG_SPEED brauchen wir für lonSpeed (pos[3])
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  function getDist(jd) {
    const pos = swe.calc_ut(jd, bodyId, flags);
    // pos[2] = Distanz in AU
    return pos[2];
  }

  function getLonSpeed(jd) {
    const pos = swe.calc_ut(jd, bodyId, flags);
    // pos[3] = Geschwindigkeit der ekl. Länge (deg/day)
    return pos[3];
  }

  return { getDist, getLonSpeed };
}

// Retro-Fenster finden: lonSpeed < 0
function findRetroWindows(getLonSpeed, jdStart, jdEnd) {
  const step = 0.5; // 12h
  const tol = 1 / 1440; // 1 Minute in Tagen

  const windows = [];
  let inRetro = false;
  let startJd = null;

  let prevJd = jdStart;
  let prevV = getLonSpeed(prevJd);

  // falls ganz am Anfang schon retro
  if (prevV < 0) {
    inRetro = true;
    startJd = jdStart;
  }

  for (let jd = jdStart + step; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const curV = getLonSpeed(curJd);

    // Eintritt: +/0 -> -
    if (!inRetro && prevV >= 0 && curV < 0) {
      const start = bisectZero(getLonSpeed, prevJd, curJd, tol);
      inRetro = true;
      startJd = start;
    }

    // Austritt: - -> +/0
    if (inRetro && prevV < 0 && curV >= 0) {
      const end = bisectZero(getLonSpeed, prevJd, curJd, tol);
      inRetro = false;
      windows.push([startJd, end]);
      startJd = null;
    }

    prevJd = curJd;
    prevV = curV;
    if (curJd >= jdEnd) break;
  }

  // falls bis Jahresende retro bleibt
  if (inRetro && startJd != null) {
    windows.push([startJd, jdEnd]);
  }

  // sehr kurze Fenster rausfiltern (numerische Artefakte)
  return windows.filter(([a, b]) => (b - a) > (2 / 24)); // > 2h
}

// Distanz-Minimum in Fenster finden (coarse 6h + refine)
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

  // refine um bestJd herum
  const left = Math.max(a, bestJd - 0.75);  // 18h links
  const right = Math.min(b, bestJd + 0.75); // 18h rechts
  const tol = 1 / 1440; // 1 Minute

  const jdMin = goldenMin(getDist, left, right, tol);
  return jdMin;
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

    // 1. Jan 00:00 UT bis 2. Jan des Folgejahres 00:00 UT (leicht überlappend)
    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0);

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist, getLonSpeed } = makeCalc(swe, bodyId);

      const perigees = [];

      if (body.mode === "SUN") {
        // Sonne: Distanz-Minimum im Jahr (Erd-Perihel). Kein Retro-Filter.
        const jdMin = minDistanceInWindow(getDist, jdStart, jdEnd);
        perigees.push({ datum: formatDateDE(jdToCalendar(jdMin)) });
      } else {
        // Planeten/Chiron: Perigäum nur innerhalb rückläufiger Fenster
        const windows = findRetroWindows(getLonSpeed, jdStart, jdEnd);

        for (const [a, b] of windows) {
          const jdMin = minDistanceInWindow(getDist, a, b);
          perigees.push({ datum: formatDateDE(jdToCalendar(jdMin)) });
        }
      }

      // Duplikate entfernen (falls zwei Retro-Fenster durch Rundung auf denselben Kalendertag fallen)
      const uniq = [];
      const seen = new Set();
      for (const p of perigees) {
        if (!seen.has(p.datum)) {
          seen.add(p.datum);
          uniq.push(p);
        }
      }

      if (uniq.length === 0) {
        results.push({
          body: body.name,
          perigees: [],
          info: "Kein Perigäum in diesem Jahr"
        });
      } else {
        totalCount += uniq.length;
        results.push({
          body: body.name,
          perigees: uniq,
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
    return res.status(500).json({
      ok: false,
      error: String(e)
    });
  } finally {
    try { swe.close(); } catch (_) {}
  }
}
