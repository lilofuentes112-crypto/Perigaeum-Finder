// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
//
// - Sonne: Erd-Perihel = Minimum der Sonnen-Distanz im Kalenderjahr
// - Merkur–Pluto: pro rückläufiger Phase genau 1 Perigäum (Distanzminimum)
// - Chiron: Astronomisch sauberer Sonderfall:
//   -> Suche globales Distanzminimum im erweiterten Fenster (Jahr ± Pad).
//   -> Nur wenn das Minimum IM Kalenderjahr liegt, wird es als Perigäum ausgegeben.
//   -> Sonst: "Kein Perigäum in diesem Jahr".
// Außerdem: pro Körper eigener Try/Catch, damit ein Fehler bei Chiron nicht alles auf 0 setzt.

import SwissEph from "swisseph-wasm";
import path from "path";

export const config = { runtime: "nodejs" };

const BODIES = [
  { id: "SE_SUN",     name: "Sonne",   mode: "SUN"   },
  { id: "SE_MERCURY", name: "Merkur",  mode: "RETRO" },
  { id: "SE_VENUS",   name: "Venus",   mode: "RETRO" },
  { id: "SE_MARS",    name: "Mars",    mode: "RETRO" },
  { id: "SE_JUPITER", name: "Jupiter", mode: "RETRO" },
  { id: "SE_SATURN",  name: "Saturn",  mode: "RETRO" },
  { id: "SE_CHIRON",  name: "Chiron",  mode: "CHIRON_GLOBAL" },
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

// Für Chiron: globales Minimum im erweiterten Fenster finden, dann prüfen ob im Jahr
function globalMinWithPad(getDist, jdYearStart, jdYearEnd, padDays) {
  const a = jdYearStart - padDays;
  const b = jdYearEnd + padDays;

  // grobes Raster über das ganze Fenster
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

  // Feinsuche um bestJd
  const left  = Math.max(a, bestJd - 5.0);
  const right = Math.min(b, bestJd + 5.0);
  const tol = 1 / 1440; // 1 Minute
  const jdMin = goldenMin(getDist, left, right, tol);

  const inYear = (jdMin >= jdYearStart && jdMin < jdYearEnd);
  return { jdMin, inYear };
}

// ---------------- SwissEph access ----------------
function makeCalc(swe, bodyId) {
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;

  function safeCalcUt(jd) {
    const pos = swe.calc_ut(jd, bodyId, flags);
    // Bei Problemen kann pos "undefined" oder kein Array sein.
    if (!pos || !Array.isArray(pos) || pos.length < 4) {
      throw new Error("calc_ut lieferte kein gültiges Array");
    }
    return pos;
  }

  return {
    getDist(jd) {
      const pos = safeCalcUt(jd);
      return pos[2]; // Distanz (AU)
    },
    getLonSpeed(jd) {
      const pos = safeCalcUt(jd);
      return pos[3]; // Längengeschwindigkeit (deg/day)
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
        error: "SwissEph init fehlgeschlagen (calc_ut nicht verfügbar). Prüfe Vercel Runtime (Node, nicht Edge)."
      });
    }

    // 2) Ephemeridenpfad setzen – DEIN Ordner liegt unter api/ephe
    const ephePath = path.join(process.cwd(), "api", "ephe");

    // Wichtig: NICHT awaiten. Und: je nach Build heißt es set_ephe_path oder swe_set_ephe_path.
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

    // Puffer für Retro-Fenster über Jahreswechsel (Planeten)
    const padRetro = 20;
    const jdCalcStart = jdYearStart - padRetro;
    const jdCalcEnd   = jdYearEnd + padRetro;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      try {
        const bodyId = swe[body.id];
        if (typeof bodyId !== "number") {
          throw new Error(`Unbekannte SwissEph-Konstante: ${body.id}`);
        }

        const { getDist, getLonSpeed } = makeCalc(swe, bodyId);

        let perigees = [];
        let info = null;
        let labelOverride = null;

        if (body.mode === "SUN") {
          const jdMin = minDistanceInWindow(getDist, jdYearStart, jdYearEnd);
          perigees = [{ datum: formatDateDE(jdToCalendar(jdMin)) }];

        } else if (body.mode === "CHIRON_GLOBAL") {
          // Chiron: globales Minimum im erweiterten Fenster, nur wenn Minimum im Jahr liegt
          const padChiron = 60; // ± 60 Tage (konservativ, sauber)
          const { jdMin, inYear } = globalMinWithPad(getDist, jdYearStart, jdYearEnd, padChiron);

          labelOverride = "Chiron";
          if (inYear) {
            perigees = [{ datum: formatDateDE(jdToCalendar(jdMin)) }];
          } else {
            perigees = [];
            info = "Kein Perigäum in diesem Jahr";
          }

        } else {
          // Planeten: pro rückläufiger Phase genau 1 Distanzminimum (wie bisher)
          const windows = findRetroWindows(getLonSpeed, jdCalcStart, jdCalcEnd);

          for (const [a0, b0] of windows) {
            const jdMin = minDistanceInWindow(getDist, a0, b0);
            if (jdMin >= jdYearStart && jdMin < jdYearEnd) {
              perigees.push({ datum: formatDateDE(jdToCalendar(jdMin)) });
            }
          }

          // Duplikate entfernen (Rundung auf Tag)
          const seen = new Set();
          perigees = perigees.filter((p) => {
            if (seen.has(p.datum)) return false;
            seen.add(p.datum);
            return true;
          });

          if (perigees.length === 0) info = "Kein Perigäum in diesem Jahr";
        }

        if (perigees.length > 0) totalCount += perigees.length;

        results.push({
          body: labelOverride || body.name,
          perigees,
          info
        });

      } catch (err) {
        // Ganz wichtig: Fehler bei einem Körper darf nicht alles killen.
        results.push({
          body: body.name,
          perigees: [],
          info: `Berechnung nicht möglich: ${String(err?.message || err)}`
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
