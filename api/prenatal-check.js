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

    // Geburt: 00:00 UT (taggenau)
    const birthTjd = swe.julday(birthYear, birthMonth, birthDay, 0, swe.SE_GREG_CAL);

    // Fenster (Schwangerschaft)
    const LOOKBACK_DAYS = 270;

    // Sperrfenster vor Geburt (damit die "Geburtsnähe" nicht als zusätzlicher Treffer zählt)
    const IGNORE_LAST_DAYS = 30;

    const startTjd = birthTjd - LOOKBACK_DAYS;
    const endTjd = birthTjd - IGNORE_LAST_DAYS;

    // Nur Langsamläufer (Mars draußen)
    const planets = [
      { name: "Jupiter", id: swe.SE_JUPITER },
      { name: "Saturn", id: swe.SE_SATURN },
      { name: "Uranus", id: swe.SE_URANUS },
      { name: "Neptun", id: swe.SE_NEPTUNE },
      { name: "Pluto", id: swe.SE_PLUTO },
      { name: "Chiron", id: swe.SE_CHIRON },
    ];

    const results = [];

    for (const planet of planets) {
      // Zielgrad = Planetenlänge am Geburtstag
      const birthCalc = swe.calc_ut(birthTjd, planet.id, swe.SEFLG_SWIEPH);
      const targetLon = norm360(getLon(birthCalc));

      const hits = [];
      const seen = new Set(); // Duplikate verhindern

      // Tagweise durchs Fenster, aber pro Tag in 2 Halbtage splitten (treffsicherer taggenau)
      for (let t = startTjd; t < endTjd; t += 1) {
        const hitA = findCrossingInInterval(swe, planet.id, targetLon, t, t + 0.5);
        const hitB = findCrossingInInterval(swe, planet.id, targetLon, t + 0.5, t + 1);

        const hit = hitA || hitB;
        if (!hit) continue;

        const ymd = revjulToYMD(swe, t);
        const key = `${ymd.year}-${ymd.month}-${ymd.day}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Für Anzeige/Retro nehmen wir die Werte am Tagesanfang (taggenau ausreichend)
        const dayCalc = swe.calc_ut(t, planet.id, swe.SEFLG_SWIEPH);
        const lon = norm360(getLon(dayCalc));
        const speedLon = getSpeedLon(dayCalc);
        const retro = speedLon < 0;

        const pos = formatZodiacPos(lon);

        hits.push({
          date: ymd,                    // {year,month,day}
          lon: round(lon, 4),           // optional fürs Debug
          sign: pos.sign,               // "Jungfrau" etc.
          deg: pos.deg,                 // 0..29
          min: pos.min,                 // 0..59
          posText: pos.text,            // z.B. "13°40′ Jungfrau"
          retro: retro ? "R" : "",      // "R" oder ""
        });
      }

      results.push({
        planet: planet.name,
        found: hits.length > 0,
        hits, // Liste der Treffer
      });
    }

    return res.status(200).json({
      ok: true,
      birthDate: { year: birthYear, month: birthMonth, day: birthDay },
      lookbackDays: LOOKBACK_DAYS,
      ignoreLastDays: IGNORE_LAST_DAYS,
      results,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// ---- Helpers ----

function getLon(calcResult) {
  // swisseph-wasm gibt ein Array zurück; [0] ist Länge
  return calcResult[0];
}

function getSpeedLon(calcResult) {
  // häufig liegt die ekliptikale Längengeschwindigkeit bei [3]
  // falls nicht vorhanden: 0 (kein Retro-Flag)
  const v = calcResult[3];
  return typeof v === "number" ? v : 0;
}

function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

// signed diff a - b in degrees, wrapped to [-180..+180]
function signedDiffDeg(a, b) {
  let d = norm360(a) - norm360(b);
  d = ((d + 540) % 360) - 180;
  return d;
}

// unwrap x by ±360 to be close to ref (continuity)
function unwrapToBeNear(x, ref) {
  let y = x;
  while (y - ref > 180) y -= 360;
  while (y - ref < -180) y += 360;
  return y;
}

// Prüft, ob Zielgrad in [t0,t1] überquert wird
function findCrossingInInterval(swe, planetId, targetLon, t0, t1) {
  const lon0 = norm360(getLon(swe.calc_ut(t0, planetId, swe.SEFLG_SWIEPH)));
  const lon1 = norm360(getLon(swe.calc_ut(t1, planetId, swe.SEFLG_SWIEPH)));

  let d0 = signedDiffDeg(lon0, targetLon);
  let d1 = signedDiffDeg(lon1, targetLon);
  d1 = unwrapToBeNear(d1, d0); // verhindert falsche Treffer an der ±180°-Sprungstelle

  const crossed =
    (d0 < 0 && d1 > 0) ||
    (d0 > 0 && d1 < 0) ||
    d0 === 0 ||
    d1 === 0;

  return crossed ? true : false;
}

function revjulToYMD(swe, tjd) {
  const cal = swe.revjul(tjd, swe.SE_GREG_CAL);
  return { year: cal.year, month: cal.month, day: cal.day };
}

function formatZodiacPos(lon) {
  const signs = [
    "Widder", "Stier", "Zwillinge", "Krebs", "Löwe", "Jungfrau",
    "Waage", "Skorpion", "Schütze", "Steinbock", "Wassermann", "Fische"
  ];
  const signIndex = Math.floor(lon / 30);
  const inSign = lon - signIndex * 30;

  const deg = Math.floor(inSign);
  const min = Math.floor((inSign - deg) * 60 + 1e-9);

  const sign = signs[signIndex] || "";
  const text = `${deg}°${String(min).padStart(2, "0")}′ ${sign}`;

  return { sign, deg, min, text };
}

function round(x, n) {
  const f = Math.pow(10, n);
  return Math.round(x * f) / f;
}
