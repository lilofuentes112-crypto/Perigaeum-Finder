// API-Test mit Swiss Ephemeris (Goldstandard-Block)

import SwissEph from "swisseph-wasm";

export default async function handler(req, res) {
  try {
    const swe = new SwissEph();
    await swe.initSwissEph();

    // Beispiel: 1. Januar 2000, 00:00 UT
    const year = 2000;
    const month = 1;
    const day = 1;
    const hour = 0;

    // Julianisches Datum berechnen
    const tjd = swe.julday(year, month, day, hour, swe.SE_GREG_CAL);

    // Beispiel: Position der Venus (nur als Test)
    const result = swe.calc_ut(tjd, swe.SE_VENUS, swe.SEFLG_SWIEPH);

    res.status(200).json({ ok: true, tjd, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}
