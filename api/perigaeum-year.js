// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto + Chiron: pro rückläufiger Phase genau 1 Perigäum (Distanzminimum)

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

// ---------------- Math helpers ----------------
function normDeltaDeg(d) {
  let x = ((d + 540) % 360) - 180;
  if (x === -180) x = 180;
  return x;
}

// Golden section minimum
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
  const flags = swe.SEFLG_SWIEPH;
  return {
    getDist(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[2];
    },
    getLon(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[0];
    }
  };
}

// ---------------- Retro windows ----------------
function findRetroWindows(getLon, jdStart, jdEnd) {
  const step = 0.125; // 3h
  const need = 3;

  const windows = [];
  let prevJd = jdStart;
  let prevLon = getLon(prevJd);

  let inRetro = false;
  let startJd = null;
  let retroStreak = 0;
  let directStreak = 0;

  for (let jd = jdStart + step; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const curLon = getLon(curJd);
    const dLon = normDeltaDeg(curLon - prevLon);
    const isRetro = dLon < 0;

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

    prevJd = curJd;
    prevLon = curLon;
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
    const year = parseInt(
      (req.method === "GET" ? req.query.year : req.body?.year) ?? "",
      10
    );

    if (!Number.isFinite(year) || year < 1900 || year > 2050) {
      return res.status(400).json({ ok: false, error: "Ungültiges Jahr." });
    }

    await swe.initSwissEph();

    const jdYearStart = swe.julday(year, 1, 1, 0);
    const jdYearEnd   = swe.julday(year + 1, 1, 1, 0);
    const pad = 7;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist, getLon } = makeCalc(swe, bodyId);
      let perigees = [];

      if (body.mode === "SUN") {
        const jdMin = minDistanceInWindow(getDist, jdYearStart, jdYearEnd);
        const cal = swe.revjul(jdMin, swe.SE_GREG_CAL);
        perigees.push({ datum: `${String(cal.day).padStart(2,"0")}.${String(cal.month).padStart(2,"0")}.${cal.year}` });
      } else {
        const windows = findRetroWindows(getLon, jdYearStart - pad, jdYearEnd + pad);

        for (const [a, b] of windows) {
          const jdMin = minDistanceInWindow(getDist, a, b);

          // 🔑 DER ENTSCHEIDENDE FIX
          if (jdMin >= jdYearStart && jdMin < jdYearEnd) {
            const cal = swe.revjul(jdMin, swe.SE_GREG_CAL);
            perigees.push({
              datum: `${String(cal.day).padStart(2,"0")}.${String(cal.month).padStart(2,"0")}.${cal.year}`
            });
          }
        }
      }

      if (perigees.length === 0) {
        results.push({ body: body.name, perigees: [], info: "Kein Perigäum in diesem Jahr" });
      } else {
        totalCount += perigees.length;
        results.push({ body: body.name, perigees, info: null });
      }
    }

    return res.status(200).json({ ok: true, year, totalCount, bodies: results });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e) });
  } finally {
    try { swe.close(); } catch (_) {}
  }
}
