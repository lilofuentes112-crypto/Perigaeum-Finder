// api/jonas-mondphasen-year.js
// Jonas-Mondphasen-Rechner
// Berechnung der individuellen Mondphasen-Rückkehrpunkte (nur echter Return, keine Gegenphase)

import SwissEph from "swisseph-wasm";

// -----------------------------
// Tierkreis (tropisch) + m/w
// -----------------------------
const ZODIAC = [
  { symbol: "♈", sex: "m" }, // Widder
  { symbol: "♉", sex: "w" }, // Stier
  { symbol: "♊", sex: "m" }, // Zwillinge
  { symbol: "♋", sex: "w" }, // Krebs
  { symbol: "♌", sex: "m" }, // Löwe
  { symbol: "♍", sex: "w" }, // Jungfrau
  { symbol: "♎", sex: "m" }, // Waage
  { symbol: "♏", sex: "w" }, // Skorpion
  { symbol: "♐", sex: "m" }, // Schütze
  { symbol: "♑", sex: "w" }, // Steinbock
  { symbol: "♒", sex: "m" }, // Wassermann
  { symbol: "♓", sex: "w" }  // Fische
];

// --- Hilfsfunktionen ---
function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

function signedDiffDeg(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

function parseISOorThrow(s) {
  const d = new Date(s);
  if (isNaN(d)) throw new Error("Ungültiges Datum: " + s);
  return d;
}

function toNumberOrThrow(s, name) {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`Ungültiger Parameter ${name}: ${s}`);
  return v;
}

function jdFromUTCDate(swe, d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return swe.julday(y, m, day, h, swe.SE_GREG_CAL);
}

function phaseAngleDeg(swe, tjd_ut) {
  const flag = swe.SEFLG_SWIEPH;
  const sun = swe.calc_ut(tjd_ut, swe.SE_SUN, flag);
  const moon = swe.calc_ut(tjd_ut, swe.SE_MOON, flag);
  return norm360(moon[0] - sun[0]);
}

function refineRootBisection(swe, t0ms, t1ms, targetAngleDeg, maxIter = 70) {
  const fAt = (ms) => {
    const d = new Date(ms);
    const jd = jdFromUTCDate(swe, d);
    const ang = phaseAngleDeg(swe, jd);
    return signedDiffDeg(ang, targetAngleDeg);
  };

  let a = t0ms;
  let b = t1ms;
  let fa = fAt(a);
  let fb = fAt(b);

  if (fa === 0) return new Date(a);
  if (fb === 0) return new Date(b);
  if (fa * fb > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = Math.floor((a + b) / 2);
    const fm = fAt(mid);

    if (Math.abs(b - a) <= 1000 || fm === 0) return new Date(mid);

    if (fa * fm <= 0) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }
  return new Date(Math.floor((a + b) / 2));
}

// -----------------------------
// CORS
// -----------------------------
function isAllowedOrigin(origin) {
  if (!origin) return true;

  const ALLOWED = new Set([
    "https://astrogypsy.de",
    "https://www.astrogypsy.de",
    "https://intern.astrogypsy.de",
    "https://www.intern.astrogypsy.de",
    "https://editor.wix.com",
    "https://www.wix.com",
    "https://manage.wix.com",
    "https://static.parastorage.com",
    "https://static.wixstatic.com",
  ]);

  if (ALLOWED.has(origin)) return true;
  if (/^https:\/\/.*\.wixsite\.com$/i.test(origin)) return true;
  if (/^https:\/\/.*\.wixstudio\.io$/i.test(origin)) return true;
  if (/^https:\/\/.*\.filesusr\.com$/i.test(origin)) return true;
  if (/^https:\/\/.*\.parastorage\.com$/i.test(origin)) return true;
  if (/^https:\/\/.*\.wixstatic\.com$/i.test(origin)) return true;

  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req, res) {
  try {
    applyCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();

    const origin = req.headers.origin || "";
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ ok: false, error: `Origin nicht erlaubt: ${origin}` });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Nur GET erlaubt." });
    }

    const swe = new SwissEph();
    await swe.initSwissEph();

    const { birth, year } = req.query;
    if (!birth || !year) {
      return res.status(400).json({ ok: false, error: "birth und year erforderlich." });
    }

    const birthDate = parseISOorThrow(birth);
    const y = toNumberOrThrow(year, "year");

    const startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(y, 11, 31, 23, 59, 59));

    const stepMs = 6 * 60 * 60 * 1000;
    const tol = 0.2;

    const jdBirth = jdFromUTCDate(swe, birthDate);
    const targetAngle = phaseAngleDeg(swe, jdBirth);

    const fAtDate = (d) => {
      const jd = jdFromUTCDate(swe, d);
      const ang = phaseAngleDeg(swe, jd);
      return { ang, f: signedDiffDeg(ang, targetAngle) };
    };

    const returns = [];
    let tPrev = new Date(startDate.getTime());
    let prev = fAtDate(tPrev);

    for (
      let t = new Date(startDate.getTime() + stepMs);
      t <= endDate;
      t = new Date(t.getTime() + stepMs)
    ) {
      const cur = fAtDate(t);

      if (prev.f === 0 || cur.f === 0 || prev.f * cur.f < 0) {
        const root = refineRootBisection(swe, tPrev.getTime(), t.getTime(), targetAngle);

        if (root) {
          const r = fAtDate(root);
          if (Math.abs(r.f) < tol) {

            const jdRoot = jdFromUTCDate(swe, root);
            const moonData = swe.calc_ut(jdRoot, swe.SE_MOON, swe.SEFLG_SWIEPH);
            const moonLon = moonData[0];

            const zodiacIndex = Math.floor(moonLon / 30);
            const zodiac = ZODIAC[zodiacIndex];
            const sexSign = `${zodiac.symbol}${zodiac.sex}`;

            returns.push({
              datetime_utc: root.toISOString(),
              sex_sign: sexSign
            });
          }
        }
      }

      tPrev = t;
      prev = cur;
    }

    return res.status(200).json({
      ok: true,
      count: returns.length,
      returns
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
