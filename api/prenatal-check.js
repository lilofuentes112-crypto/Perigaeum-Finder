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
    const birthTjd = swe.julday(
      birthYear,
      birthMonth,
      birthDay,
      0,
      swe.SE_GREG_CAL
    );

    // Planeten ohne Merkur & Venus
    const planets = [
      { name: "Mars", id: swe.SE_MARS },
      { name: "Jupiter", id: swe.SE_JUPITER },
      { name: "Saturn", id: swe.SE_SATURN },
      { name: "Uranus", id: swe.SE_URANUS },
      { name: "Neptun", id: swe.SE_NEPTUNE },
      { name: "Pluto", id: swe.SE_PLUTO },
      { name: "Chiron", id: swe.SE_CHIRON },
    ];

    // Rückblick-Fenster etwas größer, damit Aug 1964 sicher drin ist
    const LOOKBACK_DAYS = 300;

    // Alles zu nahe am Geburtstag ignorieren (sonst "selber Übergang")
    const IGNORE_LAST_DAYS = 30;

    const results = [];

    for (const planet of planets) {
      // Zielgrad = Planet am Geburtstag
      const birthPos = swe.calc_ut(birthTjd, planet.id, swe.SEFLG_SWIEPH);
      const targetLon = norm360(birthPos[0]);

      let foundDate = null;

      // Wir suchen von "weiter weg" Richtung Geburt, damit wir den früheren Treffer (z.B. Aug 64) erwischen
      // und nicht einen späten Artefakt-Treffer kurz vor der Geburt.
      for (let i = LOOKBACK_DAYS; i >= IGNORE_LAST_DAYS; i--) {
        const t0 = birthTjd - i;      // Tag 0:00 UT
        const t1 = t0 + 1;            // nächster Tag 0:00 UT

        const lon0 = norm360(swe.calc_ut(t0, planet.id, swe.SEFLG_SWIEPH)[0]);
        const lon1 = norm360(swe.calc_ut(t1, planet.id, swe.SEFLG_SWIEPH)[0]);

        // Differenzen zum Zielgrad (signed, aber dann entwrappt für Kontinuität)
        let d0 = signedDiffDeg(lon0, targetLon); // [-180..+180]
        let d1 = signedDiffDeg(lon1, targetLon); // [-180..+180]
        d1 = unwrapToBeNear(d1, d0);             // verhindert falsche Vorzeichenwechsel an der ±180°-Sprungstelle

        // Wenn innerhalb dieses Tagesintervalls die Differenz das Vorzeichen wechselt,
        // dann wurde der Zielgrad zwischen t0 und t1 überquert.
        if (d0 === 0 || d1 === 0 || (d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
          foundDate = revjulToYMD(swe, t0); // taggenau: der Tag, in dem der Übergang passiert
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

// adjust x by ±360 so that it is close to ref (continuity)
function unwrapToBeNear(x, ref) {
  let y = x;
  while (y - ref > 180) y -= 360;
  while (y - ref < -180) y += 360;
  return y;
}

function revjulToYMD(swe, tjd) {
  const cal = swe.revjul(tjd, swe.SE_GREG_CAL);
  return { year: cal.year, month: cal.month, day: cal.day };
}
