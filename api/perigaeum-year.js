import SwissEph from "swisseph-wasm";

export default async function handler(req, res) {
  try {
    const yearParam = req.query?.year || req.query?.Year || req.query?.jahr;
    const year = parseInt(yearParam, 10);

    if (!year || year < 1900 || year > 2050) {
      return res.status(400).json({
        ok: false,
        error: "Bitte ein Jahr zwischen 1900 und 2050 als ?year=JJJJ angeben."
      });
    }

    const swe = new SwissEph();
    await swe.initSwissEph();

    const bodies = [
      { name: "Merkur", code: "SE_MERCURY" },
      { name: "Venus", code: "SE_VENUS" },
      { name: "Mars", code: "SE_MARS" },
      { name: "Jupiter", code: "SE_JUPITER" },
      { name: "Saturn", code: "SE_SATURN" },
      { name: "Chiron", code: "SE_CHIRON" },
      { name: "Uranus", code: "SE_URANUS" },
      { name: "Neptun", code: "SE_NEPTUNE" },
      { name: "Pluto", code: "SE_PLUTO" }
    ];

    const startTJD = swe.julday(year, 1, 1, 0, swe.SE_GREG_CAL);
    const endTJD = swe.julday(year + 1, 1, 1, 0, swe.SE_GREG_CAL);
    const dayStep = 1.0; // 1 Tag

    const distanceAt = (tjd, bodyId) => {
      const r = swe.calc_ut(tjd, bodyId, swe.SEFLG_SWIEPH);
      return r[2]; // Distanz in AU (nur intern für Minimumsuche)
    };

    // Nur Datum, deutsches Format: TT.MM.JJJJ
    const formatDateDE = (tjd) => {
      const rev = swe.revjul(tjd, swe.SE_GREG_CAL);
      const y = rev.year;
      const m = rev.month;
      const d = rev.day;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      return `${pad(d)}.${pad(m)}.${y}`;
    };

    const refineMinimum = (tCenter, bodyId) => {
      const hourStep = 1 / 24; // 1 Stunde
      let bestT = tCenter;
      let bestD = distanceAt(tCenter, bodyId);

      for (let t = tCenter - 1; t <= tCenter + 1; t += hourStep) {
        const d = distanceAt(t, bodyId);
        if (d < bestD) {
          bestD = d;
          bestT = t;
        }
      }
      return bestT;
    };

    const resultsPerBody = [];

    for (const body of bodies) {
      const bodyId = swe[body.code];

      if (typeof bodyId !== "number") {
        resultsPerBody.push({
          body: body.name,
          perigees: [],
          info: "Konstante für diesen Körper nicht gefunden"
        });
        continue;
      }

      const samples = [];
      for (let t = startTJD; t <= endTJD; t += dayStep) {
        samples.push({ tjd: t, d: distanceAt(t, bodyId) });
      }

      const perigees = [];

      for (let i = 2; i < samples.length; i++) {
        const prevPrev = samples[i - 2];
        const prev = samples[i - 1];
        const curr = samples[i];

        if (prev.d < prevPrev.d && prev.d < curr.d) {
          const tMin = refineMinimum(prev.tjd, bodyId);
          perigees.push({
            datum: formatDateDE(tMin)
          });
        }
      }

      resultsPerBody.push({
        body: body.name,
        perigees,
        info: perigees.length === 0 ? "kein Perigäum in diesem Jahr" : null
      });
    }

    const totalCount = resultsPerBody.reduce(
      (sum, b) => sum + b.perigees.length,
      0
    );

    return res.status(200).json({
      ok: true,
      year,
      totalCount,
      bodies: resultsPerBody
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
