// api/moon-perigee-apogee-year.js
// Mond-Perigäen und -Apogäen pro Jahr (nur Datum, deutsch)

import SwissEph from "swisseph-wasm";

// Julianisches Datum -> gregorianisches Datum (UTC), nur Tag
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

  let month = E < 14 ? E - 1 : E - 13;
  let year = month > 2 ? C - 4716 : C - 4715;

  return { year, month, day };
}

function formatDateDE({ year, month, day }) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

export default async function handler(req, res) {
  // CORS – bei Bedarf kannst du hier deine Domain eintragen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

    // Jahr etwas überlappend abdecken
    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0);
    const days = Math.floor(jdEnd - jdStart);

    const perigees = [];
    const apogees = [];

    const bodyId = swe.SE_MOON;

    let prevDist = null;
    let prevTrend = null; // -1 fallend, +1 steigend

    for (let i = 0; i <= days; i++) {
      const jd = jdStart + i;
      const pos = swe.calc_ut(jd, bodyId, swe.SEFLG_SWIEPH);
      const dist = pos[2]; // Entfernung in AU

      if (prevDist !== null) {
        const trend = dist > prevDist ? +1 : -1;

        // Minimum (Perigäum): Trend wechselt von fallend auf steigend
        if (prevTrend === -1 && trend === +1) {
          const eventJd = jd - 1;
          if (eventJd >= jdStart && eventJd < jdEnd) {
            const cal = jdToCalendar(eventJd);
            perigees.push({ datum: formatDateDE(cal) });
          }
        }

        // Maximum (Apogäum): Trend wechselt von steigend auf fallend
        if (prevTrend === +1 && trend === -1) {
          const eventJd = jd - 1;
          if (eventJd >= jdStart && eventJd < jdEnd) {
            const cal = jdToCalendar(eventJd);
            apogees.push({ datum: formatDateDE(cal) });
          }
        }

        prevTrend = trend;
      }

      prevDist = dist;
    }

    return res.status(200).json({
      ok: true,
      year,
      counts: {
        perigee: perigees.length,
        apogee: apogees.length
      },
      perigees,
      apogees
    });
  } catch (e) {
    console.error("Mond-Perigäum/Apogäum-Fehler:", e);
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
