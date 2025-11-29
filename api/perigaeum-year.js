// api/perigaeum-year.js
// Jahres-Perigäum-Suche für Sonne + mehrere Planeten (nur Datum, deutsch)

import SwissEph from "swisseph-wasm";

const BODIES = [
  { id: "SE_SUN",     name: "Sonne" },
  { id: "SE_MERCURY", name: "Merkur" },
  { id: "SE_VENUS",   name: "Venus" },
  { id: "SE_MARS",    name: "Mars" },
  { id: "SE_JUPITER", name: "Jupiter" },
  { id: "SE_SATURN",  name: "Saturn" },
  { id: "SE_CHIRON",  name: "Chiron" },
  { id: "SE_URANUS",  name: "Uranus" },
  { id: "SE_NEPTUNE", name: "Neptun" },
  { id: "SE_PLUTO",   name: "Pluto" }
];

// einfache CORS-Unterstützung
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  // ggf. einschränken auf astrogypsy.de – fürs Erste offen:
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
}

// Julianisches Datum -> gregorianisches Kalenderdatum (UTC), nur Tag
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
  const day = Math.floor(dayFloat + 1e-6); // runden

  let month;
  if (E < 14) month = E - 1;
  else month = E - 13;

  let year;
  if (month > 2) year = C - 4716;
  else year = C - 4715;

  return { year, month, day };
}

function formatDateDE({ year, month, day }) {
  const dd = day.toString().padStart(2, "0");
  const mm = month.toString().padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

export default async function handler(req, res) {
  // CORS-Header immer setzen
  setCorsHeaders(req, res);

  // Preflight (OPTIONS) abhandeln
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

    // Start-JD des Jahres (1. Januar, 00:00 UT)
    const jdStart = swe.julday(year, 1, 1, 0.0);
    // wir gehen etwas über das Jahresende hinaus
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0);
    const days = Math.floor(jdEnd - jdStart);

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];
      const perigees = [];

      let prevDist = null;
      let prevTrend = null; // -1 fallend, +1 steigend

      for (let i = 0; i <= days; i++) {
        const jd = jdStart + i;
        const pos = swe.calc_ut(jd, bodyId, swe.SEFLG_SWIEPH);
        const dist = pos[2]; // Distanz in AU

        if (prevDist !== null) {
          const trend = dist > prevDist ? +1 : -1;

          // Minimum, wenn Trend von fallend (-1) auf steigend (+1) wechselt
          if (prevTrend === -1 && trend === +1) {
            const perigeeJd = jd - 1; // Minimum liegt näher am vorherigen Tag
            const cal = jdToCalendar(perigeeJd);
            perigees.push({ datum: formatDateDE(cal) });
          }

          prevTrend = trend;
        }

        prevDist = dist;
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
    return res.status(500).json({
      ok: false,
      error: String(e)
    });
  } finally {
    try {
      swe.close();
    } catch (_) {
      // ignorieren
    }
  }
}
