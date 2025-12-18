// api/perigaeum-year.js
// Jahres-Perigäum-Suche für Sonne + Planeten (nur Datum, deutsch)
// Robustere Minima-Erkennung + Retrograditäts-Filter (für Planeten)

import SwissEph from "swisseph-wasm";

const BODIES = [
  { id: "SE_SUN",     name: "Sonne",   needsRetro: false },
  { id: "SE_MERCURY", name: "Merkur",  needsRetro: true  },
  { id: "SE_VENUS",   name: "Venus",   needsRetro: true  },
  { id: "SE_MARS",    name: "Mars",    needsRetro: true  },
  { id: "SE_JUPITER", name: "Jupiter", needsRetro: true  },
  { id: "SE_SATURN",  name: "Saturn",  needsRetro: true  },
  { id: "SE_CHIRON",  name: "Chiron",  needsRetro: true  },
  { id: "SE_URANUS",  name: "Uranus",  needsRetro: true  },
  { id: "SE_NEPTUNE", name: "Neptun",  needsRetro: true  },
  { id: "SE_PLUTO",   name: "Pluto",   needsRetro: true  }
];

// einfache CORS-Unterstützung
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
  const day = Math.floor(dayFloat + 1e-6);

  let month;
  if (E < 14) month = E - 1;
  else month = E - 13;

  let year;
  if (month > 2) year = C - 4716;
  else year = C - 4715;

  return { year, month, day };
}

function formatDateDE({ year, month, day }) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

// Winkel-Differenz in Grad auf [-180..+180]
function angDiffDeg(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

// geozentrische Position (λ, β, r) in Grad/AU
function calcGeo(swe, jd, bodyId) {
  const pos = swe.calc_ut(jd, bodyId, swe.SEFLG_SWIEPH);
  return { lon: pos[0], lat: pos[1], dist: pos[2] };
}

// Retrograd? (über 1 Tag): wenn geozentrische Länge abnimmt
function isRetrograde(swe, jd, bodyId) {
  // Sonne braucht keine Retrograd-Prüfung
  const p0 = calcGeo(swe, jd - 0.5, bodyId).lon;
  const p1 = calcGeo(swe, jd + 0.5, bodyId).lon;
  const d = angDiffDeg(p1, p0); // Fortschritt über ~1 Tag
  return d < 0;
}

// Deduplizieren: wenn mehrere „Minima“ sehr nahe beieinander liegen,
// behalten wir nur das kleinste Distanzminimum.
function dedupeByWindow(events, windowDays = 10) {
  if (!events.length) return events;
  const out = [];
  let group = [events[0]];

  for (let i = 1; i < events.length; i++) {
    const prev = group[group.length - 1];
    const cur = events[i];
    if (Math.abs(cur.jd - prev.jd) <= windowDays) {
      group.push(cur);
    } else {
      // bestes der Gruppe
      group.sort((a, b) => a.dist - b.dist);
      out.push(group[0]);
      group = [cur];
    }
  }
  group.sort((a, b) => a.dist - b.dist);
  out.push(group[0]);
  return out;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

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

    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0); // leicht überlappend
    const days = Math.floor(jdEnd - jdStart);

    // Epsilon: Mindest-"Höhe" des lokalen Minimums, damit kleine Zacken ignoriert werden.
    // 1e-5 AU ≈ 1500 km (grobe Größenordnung)
    const EPS = 1e-5;

    const results = [];
    let totalCount = 0;

    for (const body of BODIES) {
      const bodyId = swe[body.id];

      // Wir nutzen ein 3-Tages-Fenster (i-1, i, i+1) und prüfen lokales Minimum:
      // dist[i] < dist[i-1] und dist[i] <= dist[i+1] (plus EPS-Bedingungen)
      const candidates = [];

      // Vorab Distanzwerte in Array (stabiler + schneller als dauernd mehrfach zu rechnen)
      const distArr = new Array(days + 1);
      const lonArr = new Array(days + 1); // für Retrograd (falls nötig)

      for (let i = 0; i <= days; i++) {
        const jd = jdStart + i;
        const geo = calcGeo(swe, jd, bodyId);
        distArr[i] = geo.dist;
        lonArr[i] = geo.lon;
      }

      // Lokale Minima suchen (nicht am Rand)
      for (let i = 1; i < days; i++) {
        const dPrev = distArr[i - 1];
        const dHere = distArr[i];
        const dNext = distArr[i + 1];

        // robust: es muss wirklich "runter und wieder rauf" gehen
        const downEnough = (dPrev - dHere) > EPS;
        const upEnough   = (dNext - dHere) > EPS;

        if (downEnough && (dHere <= dNext) && upEnough) {
          const jd = jdStart + i;

          // Retrograd-Filter (außer Sonne)
          if (body.needsRetro) {
            // Tagesdelta der Länge um jd herum
            const lon0 = lonArr[i - 1];
            const lon1 = lonArr[i + 1];
            const dLon = angDiffDeg(lon1, lon0); // über 2 Tage
            // rückläufig, wenn die Länge im Mittel abnimmt
            if (!(dLon < 0)) continue;
          }

          candidates.push({ jd, dist: dHere });
        }
      }

      // Deduplizieren (falls numerische Zacken mehrere "Minima" nahe beieinander erzeugen)
      const perigeesJd = dedupeByWindow(candidates, 12);

      // Nur Events, deren Kalenderdatum im Zieljahr liegt (UTC-Kalenderdatum)
      const perigees = [];
      for (const ev of perigeesJd) {
        const cal = jdToCalendar(ev.jd);
        if (cal.year === year) {
          perigees.push({ datum: formatDateDE(cal) });
        }
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
    try { swe.close(); } catch (_) {}
  }
}
