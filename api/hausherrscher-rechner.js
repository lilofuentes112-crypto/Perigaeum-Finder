// api/hausherrscher-rechner.js
// Hausherrscher-Rechner (Placidus oder Whole Sign Houses)
// Ausgabe: Haus, Zeichen, Herrscher + Hausposition (mit 10%-Regel), MH (eingeschlossene Zeichen)
// Sonderregel: Jungfrau-Herrscher = Chiron
//
// GET-Parameter:
// - date=YYYY-MM-DD
// - time=HH:MM          (lokale Zeit)
// - tz=+1 / -6 / +2.5   (Zeitzonen-Offset in Stunden, lokal = UTC + tz)
// - lat=...             (Breite in Dezimalgrad, Nord +)
// - lon=...             (Länge in Dezimalgrad, Ost +, West -)
// - hsys=P oder W       (optional; Default P)
//   P=Placidus, W=Whole Sign Houses
//
// Beispiel:
// /api/hausherrscher-rechner?date=2000-01-01&time=12:00&tz=+1&lat=47.37&lon=8.54&hsys=P

import SwissEph from "swisseph-wasm";

// -----------------------------
// CORS / Domain-Allowlist (Goldstandard)
// -----------------------------
function isAllowedOrigin(origin) {
  if (!origin) return true; // Direkter Browseraufruf zulassen

  const ALLOWED = new Set([
    "https://astrogypsy.de",
    "https://www.astrogypsy.de",
    "https://intern.astrogypsy.de",
    "https://www.intern.astrogypsy.de",
  ]);

  if (ALLOWED.has(origin)) return true;

  // Wix typische Varianten
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

// -----------------------------
// Helpers
// -----------------------------
const SIGN_DE = [
  "Widder",
  "Stier",
  "Zwillinge",
  "Krebs",
  "Löwe",
  "Jungfrau",
  "Waage",
  "Skorpion",
  "Schütze",
  "Steinbock",
  "Wassermann",
  "Fische",
];

function norm360(x) {
  let v = Number(x);
  v = ((v % 360) + 360) % 360;
  return v;
}

function signIndexFromLon(lon) {
  const L = norm360(lon);
  return Math.floor(L / 30); // 0..11
}

function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

function parseTime(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function parseTz(tzStr) {
  const s = String(tzStr || "").trim();
  if (!s) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || Math.abs(v) > 14) return null;
  return v; // hours
}

function parseFloatParam(x) {
  const v = Number(String(x || "").trim());
  if (!Number.isFinite(v)) return null;
  return v;
}

function parseHsys(x) {
  const s = String(x || "").trim().toUpperCase();
  if (!s) return "P";
  if (s === "P" || s === "W") return s;
  if (s === "PLACIDUS") return "P";
  if (s === "WHOLE" || s === "WHOLESIGN" || s === "WHOLE SIGN" || s === "WHOLE_SIGN") return "W";
  return null;
}

function isArrayLike(a) {
  return a && typeof a.length === "number";
}
function toPlainArray(a) {
  return isArrayLike(a) ? Array.from(a) : null;
}

// Modular distance from start -> x in [0..360)
function modDist(start, x) {
  return norm360(x - start);
}

// House length start->end (mod 360), always positive (0..360)
function houseLen(start, end) {
  return norm360(end - start);
}

// Find house index 1..12 for a longitude, using cusp degrees (1..12)
function houseIndexForLon(lon, cusps) {
  const L = norm360(lon);
  for (let i = 1; i <= 12; i++) {
    const start = norm360(cusps[i]);
    const end = norm360(cusps[i === 12 ? 1 : i + 1]);

    if (start === end) continue;

    if (start < end) {
      if (L >= start && L < end) return i;
    } else {
      if (L >= start || L < end) return i;
    }
  }
  return 12;
}

// 10%-Regel: wenn im letzten 10% (inkl. Grenze) -> "H/(H+1)"
function houseStringWith10pct(lon, cusps) {
  const H = houseIndexForLon(lon, cusps);
  const start = norm360(cusps[H]);
  const end = norm360(cusps[H === 12 ? 1 : H + 1]);
  const len = houseLen(start, end);
  const rel = modDist(start, lon);
  const threshold = len * 0.9;

  const nextH = H === 12 ? 1 : H + 1;
  if (len > 0 && rel >= threshold) return `${H}/${nextH}`;
  return `${H}`;
}

// Ruler mapping (German planet names), with Virgo -> Chiron
function rulerForSign(signIdx) {
  switch (signIdx) {
    case 0: return "Mars";
    case 1: return "Venus";
    case 2: return "Merkur";
    case 3: return "Mond";
    case 4: return "Sonne";
    case 5: return "Chiron"; // Sonderregel
    case 6: return "Venus";
    case 7: return "Pluto";
    case 8: return "Jupiter";
    case 9: return "Saturn";
    case 10: return "Uranus";
    case 11: return "Neptun";
    default: return "?";
  }
}

// Planet constants for SwissEph
function planetIdByName(swe, name) {
  switch (name) {
    case "Sonne": return swe.SE_SUN;
    case "Mond": return swe.SE_MOON;
    case "Merkur": return swe.SE_MERCURY;
    case "Venus": return swe.SE_VENUS;
    case "Mars": return swe.SE_MARS;
    case "Jupiter": return swe.SE_JUPITER;
    case "Saturn": return swe.SE_SATURN;
    case "Uranus": return swe.SE_URANUS;
    case "Neptun": return swe.SE_NEPTUNE;
    case "Pluto": return swe.SE_PLUTO;
    case "Chiron": return swe.SE_CHIRON;
    default: return null;
  }
}

// MH via Zeichenfolge: fehlende Zeichen zwischen cuspSign[i] und cuspSign[i+1]
function interceptedSignsByHouse(cuspSigns) {
  const mhSigns = Array.from({ length: 13 }, () => []); // 1..12
  for (let i = 1; i <= 12; i++) {
    const cur = cuspSigns[i];
    const next = cuspSigns[i === 12 ? 1 : i + 1];
    let s = (cur + 1) % 12;
    while (s !== next) {
      mhSigns[i].push(s);
      s = (s + 1) % 12;
    }
  }
  return mhSigns;
}

function extractLonFromCalcResult(r) {
  // swisseph-wasm kann je nach Build liefern:
  // - { data: Float64Array([...]) }
  // - { data: [...] }
  // - direkt Array/TypedArray
  const v =
    (r && r.data && isArrayLike(r.data) ? r.data[0] : undefined) ??
    (isArrayLike(r) ? r[0] : undefined);
  return Number(v);
}

// -----------------------------
// Haupt-Handler
// -----------------------------
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

    const { date, time, tz, lat, lon, hsys } = req.query || {};

    const d = parseDate(date);
    const t = parseTime(time);
    const tzH = parseTz(tz);
    const latV = parseFloatParam(lat);
    const lonV = parseFloatParam(lon);
    const h = parseHsys(hsys);

    if (!d) return res.status(400).json({ ok: false, error: "Parameter date fehlt/ungültig (YYYY-MM-DD)." });
    if (!t) return res.status(400).json({ ok: false, error: "Parameter time fehlt/ungültig (HH:MM)." });
    if (tzH === null) return res.status(400).json({ ok: false, error: "Parameter tz fehlt/ungültig (z.B. +1, -6, +2.5)." });
    if (latV === null || latV < -90 || latV > 90) return res.status(400).json({ ok: false, error: "Parameter lat fehlt/ungültig (-90..90)." });
    if (lonV === null || lonV < -180 || lonV > 180) return res.status(400).json({ ok: false, error: "Parameter lon fehlt/ungültig (-180..180, Ost +, West -)." });
    if (!h) return res.status(400).json({ ok: false, error: "Parameter hsys ungültig (P oder W)." });

    // --- SwissEph Goldstandard ---
    const swe = new SwissEph();
    await swe.initSwissEph();
    // --- Ende Goldstandard ---

    // Lokalzeit -> UT (lokal = UTC + tz)
    const localHour = t.hh + t.mm / 60;
    const utHour = localHour - tzH;

    const tjd_ut = swe.julday(d.y, d.mo, d.d, utHour, swe.SE_GREG_CAL);

    // ---------------------------------------------------------
    // Häuser:
    // - Für Placidus direkt houses_ex(...,"P")
    // - Für Whole Sign: ASC via houses_ex(...,"P") holen, dann 30°-Cusps bauen
    // ---------------------------------------------------------
    const flagsH = swe.SEFLG_SWIEPH;

    // 1) Immer ASC/MC via Placidus holen (stabil, und wir brauchen ASC für Whole Sign)
    const houseBase = await swe.houses_ex(tjd_ut, flagsH, latV, lonV, "P");
    const baseCusps = toPlainArray(houseBase?.cusps ?? houseBase?.cusp);
    const baseAscmc = toPlainArray(houseBase?.ascmc ?? houseBase?.ascMC ?? houseBase?.asc_mc);

    if (!baseCusps || baseCusps.length < 13) {
      return res.status(500).json({
        ok: false,
        error: "Häuserberechnung fehlgeschlagen (Placidus: cusps fehlen).",
      });
    }
    if (!baseAscmc || baseAscmc.length < 2 || !Number.isFinite(Number(baseAscmc[0])) || !Number.isFinite(Number(baseAscmc[1]))) {
      return res.status(500).json({
        ok: false,
        error: "Häuserberechnung fehlgeschlagen (ASC/MC nicht gefunden).",
      });
    }

    // 2) Cusps final bestimmen
    let cuspArr = null;

    if (h === "P") {
      cuspArr = baseCusps;
    } else {
      // Whole Sign Houses aus ASC-Zeichen
      const ascLon = norm360(baseAscmc[0]);
      const ascSign = signIndexFromLon(ascLon);
      const cusp1 = ascSign * 30; // Beginn des ASC-Zeichens
      cuspArr = new Array(13).fill(0);
      for (let i = 1; i <= 12; i++) {
        cuspArr[i] = norm360(cusp1 + (i - 1) * 30);
      }
    }

    // Normalize cusps into 1..12
    const cusps = new Array(13).fill(0);
    for (let i = 1; i <= 12; i++) {
      cusps[i] = norm360(cuspArr[i]);
    }

    // Cusp signs
    const cuspSigns = new Array(13).fill(0);
    for (let i = 1; i <= 12; i++) {
      cuspSigns[i] = signIndexFromLon(cusps[i]);
    }

    // Intercepted signs (Whole Sign ergibt automatisch keine Lücken)
    const mhSignsByHouse = interceptedSignsByHouse(cuspSigns);

    // Compute planet longitudes needed (rulers + MH rulers)
    const neededPlanetNames = new Set();
    for (let i = 1; i <= 12; i++) {
      neededPlanetNames.add(rulerForSign(cuspSigns[i]));
      for (const sIdx of mhSignsByHouse[i]) neededPlanetNames.add(rulerForSign(sIdx));
    }

    // Calc longitudes
    const planetLon = {};
    const flags = swe.SEFLG_SWIEPH;

    for (const pName of neededPlanetNames) {
      const pid = planetIdByName(swe, pName);
      if (pid == null) {
        return res.status(500).json({ ok: false, error: `Unbekannter Planet in Mapping: ${pName}` });
      }
      const r = swe.calc_ut(tjd_ut, pid, flags);
      const lonEcl = extractLonFromCalcResult(r);

      if (!Number.isFinite(lonEcl)) {
        return res.status(500).json({
          ok: false,
          error: `Planetberechnung fehlgeschlagen: ${pName}`,
        });
      }
      planetLon[pName] = norm360(lonEcl);
    }

    // Build rows
    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const signIdx = cuspSigns[i];
      const signName = SIGN_DE[signIdx];
      const ruler = rulerForSign(signIdx);

      const rulerHouse = houseStringWith10pct(planetLon[ruler], cusps);

      const mh = [];
      for (const sIdx of mhSignsByHouse[i]) {
        const mhRuler = rulerForSign(sIdx);
        const mhHouse = houseStringWith10pct(planetLon[mhRuler], cusps);
        mh.push({
          sign: SIGN_DE[sIdx],
          planet: mhRuler,
          house: mhHouse,
        });
      }

      rows.push({
        house: i,
        sign: signName,
        ruler: { planet: ruler, house: rulerHouse },
        mh,
      });
    }

    const systemName = h === "P" ? "Placidus" : "Whole Sign Houses";

    return res.status(200).json({
      ok: true,
      system: systemName,
      hsys: h,
      input: {
        date: `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`,
        time: `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`,
        tz: tzH,
        lat: latV,
        lon: lonV,
      },
      tjd_ut,
      asc_mc: {
        asc: norm360(baseAscmc[0]),
        mc: norm360(baseAscmc[1]),
      },
      cusps: {
        deg: cusps.slice(1),
        signs: cuspSigns.slice(1).map((x) => SIGN_DE[x]),
      },
      rows,
      notes: {
        mhLabel: "MH = Mitherrscher (eingeschlossene Zeichen).",
        tenPercentRule: "10%-Regel: steht ein Herrscher in den letzten 10% eines Hauses (inkl. Grenze), wird H/(H+1) ausgegeben.",
        virgoRuler: "Jungfrau-Herrscher ist in diesem Tool Chiron.",
        wholeSignNote: "Whole Sign: Häuser werden aus dem ASC-Zeichen abgeleitet (je 30°). ASC/MC werden trotzdem aus Placidus-Basis (houses_ex mit 'P') genommen.",
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}
