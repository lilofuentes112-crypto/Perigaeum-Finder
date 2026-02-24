import SwissEph from "swisseph-wasm";

export default async function handler(req, res) {
  // CORS (für Wix-Embed)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { year, month, day } = req.query;

    if (!year || !month || !day) {
      return res.status(400).json({
        ok: false,
        error: "Bitte year, month und day als Parameter angeben.",
      });
    }

    const swe = new SwissEph();
    await swe.initSwissEph();

    const birthYear = parseInt(year, 10);
    const birthMonth = parseInt(month, 10);
    const birthDay = parseInt(day, 10);

    // Geburtstag auf 00:00 UT (taggenau)
    const birthTjd = swe.julday(birthYear, birthMonth, birthDay, 0, swe.SE_GREG_CAL);

    // Planeten ohne Merkur und Venus
    // (Toleranzen hier nur als "Sicherheitsnetz", falls ein exakter Treffer genau auf 0:00 fällt)
    const planets = [
      { name: "Mars", id: swe.SE_MARS, epsDeg: 0.05 },
      { name: "Jupiter", id: swe.SE_JUPITER, epsDeg: 0.05 },
      { name: "Saturn", id: swe.SE_SATURN, epsDeg: 0.05 },
      { name: "Uranus", id: swe.SE_URANUS, epsDeg: 0.03 },
      { name: "Neptun", id: swe.SE_NEPTUNE, epsDeg: 0.03 },
      { name: "Pluto", id: swe.SE_PLUTO, epsDeg: 0.03 },
      { name: "Chiron", id: swe.SE_CHIRON, epsDeg: 0.03 },
    ];

    // Wie viele Tage rückwärts
    const LOOKBACK_DAYS = 270;

    // Wie viele Tage vor Geburt ignorieren (sonst kommen "Pseudo-Treffer" direkt vor der Geburt)
    const IGNORE_LAST_DAYS = 7;

    const results = [];

    for (const planet of planets) {
      // Radix-Länge am Geburtstag
      const birthPos = swe.calc_ut(birthTjd, planet.id, swe.SEFLG_SWIEPH);
      const targetLon = norm360(birthPos[0]);

      let foundDate = null;

      // Wir prüfen Tagesintervalle: [t0 -> t1], wo t1 = t0 + 1 Tag
      // Rückwärts: t0 = birthTjd - i, t1 = birthTjd - i + 1
      for (let i = IGNORE_LAST_DAYS; i <= LOOKBACK_DAYS; i++) {
        const t0 = birthTjd - i;
        const t1 = t0 + 1;

        const lon0 = norm360(swe.calc_ut(t0, planet.id, swe.SEFLG_SWIEPH)[0]);
        const lon1 = norm360(swe.calc_ut(t1, planet.id, swe.SEFLG_SWIEPH)[0]);

        const d0 = signedDiffDeg(lon0, targetLon); // [-180..+180]
        const d1 = signedDiffDeg(lon1, targetLon);

        // Fall A: exakt (oder sehr nahe) auf einem der Tagespunkte
        if (Math.abs(d0) <= planet.epsDeg) {
          foundDate = revjulToYMD(swe, t0);
          break;
        }
        if (Math.abs(d1) <= planet.epsDeg) {
          foundDate = revjulToYMD(swe, t1);
          break;
        }

        // Fall B: Übertritt innerhalb des Tagesintervalls
        // (Vorzeichenwechsel => Zielgrad wurde zwischen t0 und t1 überquert)
        if (d0 === 0 || d1 === 0 || (d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
          // Als "taggenau" geben wir den Tag t0 aus (der Tag, in dem der Übertritt passiert)
          foundDate = revjulToYMD(swe, t0);
          break;
        }
      }

      results.push({
        planet: planet.name,
        found: foundDate !== null,
        date: foundDate,
      });
    }

    return res.status(200).json({
      ok: true,
      birthDate: { year: birthYear, month: birthMonth, day: birthDay },
      ignoreLastDays: IGNORE_LAST_DAYS,
      lookbackDays: LOOKBACK_DAYS,
      results,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// --- Helpers ---

function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

// signed difference a - b in degrees, wrapped to [-180..+180]
function signedDiffDeg(a, b) {
  let d = norm360(a) - norm360(b);
  d = ((d + 540) % 360) - 180;
  return d;
}

function revjulToYMD(swe, tjd) {
  const cal = swe.revjul(tjd, swe.SE_GREG_CAL);
  return { year: cal.year, month: cal.month, day: cal.day };
}
