// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto + Chiron: pro rückläufiger Phase genau 1 Perigäum (Distanzminimum)
// Retro-Erkennung über SwissEphemeris SPEED (robust, kein Station-Flattern per dLon)

import SwissEph from "swisseph-wasm";
import path from "path";

// Falls Vercel/Next irrtümlich Edge nimmt: erzwinge Node
export const config = { runtime: "nodejs" };

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
    if (Number.isFinite(d) && (!Number.isFinite(bestD) || d < bestD)) {
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
// WICHTIG: Bei fehlenden Ephemeriden (z.B. Chiron ohne seas_15.se1) liefert SwissEph
// entweder Fehler oder NaN. Das fangen wir ab, damit nicht "0 Termine" entsteht, sondern
// eine klare Info.
function makeCalc(swe, bodyId) {
  const flagsDist  = swe.SEFLG_SWIEPH;                 // Distanz reicht ohne SPEED
  const flagsSpeed = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  return {
    getDist(jd) {
      try {
        const pos = swe.calc_ut(jd, bodyId, flagsDist);
        const r = pos?.[2];
        return Number.isFinite(r) ? r : NaN;
      } catch (_) {
        return NaN;
      }
    },
    getLonSpeed(jd) {
      try {
        const pos = swe.calc_ut(jd, bodyId, flagsSpeed);
        const sp = pos?.[3];
        return Number.isFinite(sp) ? sp : NaN;
      } catch (_) {
        return NaN;
      }
    }
  };
}

// Retro-Fenster (Hysterese)
function findRetroWindows(getLonSpeed, jdStart, jdEnd) {
  const step = 0.125; // 3h
  const need = 3;     // 9h Stabilität
  const epsSpeed = 1e-6;

  const windows = [];
  let inRetro = false;
  let startJd = null;
  let retroStreak = 0;
  let directStreak = 0;

  for (let jd = jdStart; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const sp = getLonSpeed(curJd);

    // wenn Speed nicht berechenbar ist -> keine Retro-Fenster möglich
    if (!Number.isFinite(sp)) {
      if (curJd >= jdEnd) break;
      continue;
    }

    if (Math.abs(sp) <= epsSpeed) {
      if (curJd >= jdEnd) break;
      continue;
    }

    const isRetro = sp < 0;

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

    // 1) WASM initialisieren
    await swe.initSwissEph();

    if (typeof swe.calc_ut !== "function") {
      return res.status(500).json({
        ok: false,
        error:
          "SwissEph init fehlgeschlagen (calc_ut nicht verfügbar). Prüfe Vercel Runtime (Node, nicht Edge)."
      });
    }

    // 2) Ephemeridenpfad setzen – DEIN Ordner liegt unter api/ephe
    // (Das ist korrekt für dein Repo-Layout.)
    const ephePath = path.join(process.cwd(), "api", "ephe");

    // Wichtig: nicht awaiten (swisseph-wasm ist hier synchron)
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

    // Puffer für Retro-Fenster über Jahreswechsel
    const pad = 20;
    const jdCalcStart = jdYearStart - pad;
    const jdCalcEnd   = jdYearEnd + pad;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const { getDist, getLonSpeed } = makeCalc(swe, bodyId);

      // HARTE PLAUSI-PRÜFUNG: kann SwissEph diesen Körper überhaupt rechnen?
      // (Bei Chiron fehlt sonst fast immer seas_15.se1 im ephe-Ordner.)
      const testDist = getDist(jdYearStart);
      const testSpd  = (body.mode === "RETRO") ? getLonSpeed(jdYearStart) : 0;

      if (!Number.isFinite(testDist) || (body.mode === "RETRO" && !Number.isFinite(testSpd))) {
        results.push({
          body: body.name,
          perigees: [],
          info:
            body.id === "SE_CHIRON"
              ? "Chiron nicht berechenbar: sehr wahrscheinlich fehlt die Ephemeriden-Datei seas_15.se1 im Ordner api/ephe."
              : "Planet/Körper nicht berechenbar: Ephemeriden-Dateien fehlen oder ephePath stimmt nicht."
        });
        continue;
      }

      let perigees = [];

      if (body.mode === "SUN") {
        // Sonne: Perihel (Minimum Distanz) im Kalenderjahr
        const jdMin = minDistanceInWindow(getDist, jdYearStart, jdYearEnd);
        if (Number.isFinite(jdMin)) {
          perigees = [{ datum: formatDateDE(jdToCalendar(jdMin)) }];
        }
      } else {
        // Pro rückläufiger Phase genau 1 Distanzminimum
        const windows = findRetroWindows(getLonSpeed, jdCalcStart, jdCalcEnd);

        for (const [a0, b0] of windows) {
          const jdMin = minDistanceInWindow(getDist, a0, b0);
          if (Number.isFinite(jdMin) && jdMin >= jdYearStart && jdMin < jdYearEnd) {
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
