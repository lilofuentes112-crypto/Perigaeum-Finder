import SwissEph from "swisseph-wasm";

export default async function handler(req, res) {
  try {
    const { year, month, day } = req.query;

    if (!year || !month || !day) {
      return res.status(400).json({
        ok: false,
        error: "Bitte year, month und day als Parameter angeben."
      });
    }

    const swe = new SwissEph();
    await swe.initSwissEph();

    const birthYear = parseInt(year);
    const birthMonth = parseInt(month);
    const birthDay = parseInt(day);

    const birthTjd = swe.julday(
      birthYear,
      birthMonth,
      birthDay,
      0,
      swe.SE_GREG_CAL
    );

    // Planeten ohne Merkur und Venus
    const planets = [
      { name: "Mars", id: swe.SE_MARS },
      { name: "Jupiter", id: swe.SE_JUPITER },
      { name: "Saturn", id: swe.SE_SATURN },
      { name: "Uranus", id: swe.SE_URANUS },
      { name: "Neptun", id: swe.SE_NEPTUNE },
      { name: "Pluto", id: swe.SE_PLUTO },
      { name: "Chiron", id: swe.SE_CHIRON }
    ];

    const results = [];

    for (const planet of planets) {
      const birthPos = swe.calc_ut(
        birthTjd,
        planet.id,
        swe.SEFLG_SWIEPH
      );

      const birthLongitude = birthPos[0];

      let foundDate = null;

      // 270 Tage rückwärts
      for (let i = 1; i <= 270; i++) {
        const tjd = birthTjd - i;

        const pos = swe.calc_ut(
          tjd,
          planet.id,
          swe.SEFLG_SWIEPH
        );

        const longitude = pos[0];

        let diff = Math.abs(longitude - birthLongitude);

        if (diff > 180) {
          diff = 360 - diff;
        }

        // Toleranz 0.5°
        if (diff < 0.5) {
          const cal = swe.revjul(tjd, swe.SE_GREG_CAL);
          foundDate = {
            year: cal.year,
            month: cal.month,
            day: cal.day
          };
          break;
        }
      }

      results.push({
        planet: planet.name,
        found: foundDate !== null,
        date: foundDate
      });
    }

    res.status(200).json({
      ok: true,
      birthDate: { year: birthYear, month: birthMonth, day: birthDay },
      results
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
