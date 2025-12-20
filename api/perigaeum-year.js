// api/perigaeum-year.js
// Jahres-Perigäum-Rechner (Datum, deutsch, UTC)
//
// Astronomisch korrekt:
// Perigäum = lokales Minimum der geozentrischen Distanz r(t)
// <=> dr/dt wechselt von NEGATIV zu POSITIV
// dr/dt wird hier numerisch aus r(t) berechnet (robust, unabhängig von pos[5]).

import SwissEph from "swisseph-wasm";
import path from "path";

// Falls Vercel/Next irrtümlich Edge nimmt: erzwinge Node
export const config = { runtime: "nodejs" };

const BODIES = [
  { id: "SE_SUN",     name: "Sonne"   },
  { id: "SE_MERCURY", name: "Merkur"  },
  { id: "SE_VENUS",   name: "Venus"   },
  { id: "SE_MARS",    name: "Mars"    },
  { id: "SE_JUPITER", name: "Jupiter" },
  { id: "SE_SATURN",  name: "Saturn"  },
  { id: "SE_CHIRON",  name: "Chiron"  },
  { id: "SE_URANUS",  name: "Uranus"  },
  { id: "SE_NEPTUNE", name: "Neptun"  },
  { id: "SE_PLUTO",   name: "Pluto"   }
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

// ---------------- SwissEph access ----------------
function makeCalc(swe, bodyId) {
  // SPEED nicht nötig, wir nutzen nur Distanz
  const flags = swe.SEFLG_SWIEPH;

  return {
    getDist(jd) {
      const pos = swe.calc_ut(jd, bodyId, flags);
      return pos[2]; // Distanz (AU)
    }
  };
}

// ---------------- Root find via bisection on dr/dt ----------------
function bisectZero(f, a, b, tolDays = 1 / 1440) { // 1 Minute
  let fa = f(a);
  let fb = f(b);

  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;

  let left = a, right = b;
  for (let it = 0; it < 80; it++) {
    const mid = (left + right) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;

    if ((right - left) <= tolDays) return mid;

    if (fa * fm <= 0) {
      right = mid;
      fb = fm;
    } else {
      left = mid;
      fa = fm;
    }
  }
  return (left + right) / 2;
}

// ---------------- Find perigees ----------------
// Perigäum: dr/dt wechselt NEG -> POS
function findPerigeesNumerical(getDist, jdStart, jdEnd) {
  // Sampling (12h) reicht für Perigäen, robust und nicht „zitterig“
  const step = 0.5;

  // Ableitungsschritt h (in Tagen): 0.02 d ~ 28.8 Minuten
  // -> stabil, aber fein genug, um Nullstelle sauber zu finden
  const h = 0.02;

  // Numerische Ableitung dr/dt
  const drdt = (jd) => (getDist(jd + h) - getDist(jd - h)) / (2 * h);

  const hits = [];

  let prevJd = jdStart;
  let prevV = drdt(prevJd);

  for (let jd = jdStart + step; jd <= jdEnd + 1e-9; jd += step) {
    const curJd = Math.min(jd, jdEnd);
    const curV = drdt(curJd);

    if (!Number.isFinite(prevV) || !Number.isFinite(curV)) {
      prevJd = curJd;
      prevV = curV;
      continue;
    }

    // NEG -> POS
    if (prevV < 0 && curV > 0) {
      const root = bisectZero(drdt, prevJd, curJd);
      if (root != null) hits.push(root);
    }

    prevJd = curJd;
    prevV = curV;

    if (curJd >= jdEnd) break;
  }

  return hits;
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

    if (typeof swe.calc_ut !== "function") {
      return res.status(500).json({
        ok: false,
        error: "SwissEph init fehlgeschlagen (calc_ut nicht verfügbar). Prüfe Vercel Runtime (Node, nicht Edge)."
      });
    }

    // Ephemeridenpfad: deine Files liegen in api/ephe
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

    const jdYearStart = swe.julday(year, 1, 1, 0.0, swe.SE_GREG_CAL);
    const jdYearEnd   = swe.julday(year + 1, 1, 1, 0.0, swe.SE_GREG_CAL);

    // kleines Padding für Events knapp an der Grenze
    const pad = 10;
    const jdCalcStart = jdYearStart - pad;
    const jdCalcEnd   = jdYearEnd + pad;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];

      if (!Number.isFinite(bodyId)) {
        results.push({
          body: body.name,
          perigees: [],
          info: `Body-ID ${body.id} nicht verfügbar`
        });
        continue;
      }

      const { getDist } = makeCalc(swe, bodyId);

      // astronomische Perigäen = lokale Minima der Distanz
      const roots = findPerigeesNumerical(getDist, jdCalcStart, jdCalcEnd);

      let perigees = roots
        .filter((jd) => jd >= jdYearStart && jd < jdYearEnd)
        .map((jd) => ({ datum: formatDateDE(jdToCalendar(jd)) }));

      // Duplikate entfernen (wenn zwei Roots auf gleichen Tag runden)
      const seen = new Set();
      perigees = perigees.filter((p) => {
        if (seen.has(p.datum)) return false;
        seen.add(p.datum);
        return true;
      });

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
    try { if (typeof swe.close === "function") swe.close(); } catch (_) {}
  }
}
