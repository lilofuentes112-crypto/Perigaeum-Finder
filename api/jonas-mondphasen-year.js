// api/jonas-mondphasen-year.js
// Jonas-Mondphasen-Rechner
// Berechnung der individuellen Mondphasen-Rückkehrpunkte (nur echter Return, keine Gegenphase)

import SwissEph from "swisseph-wasm";

// --- Hilfsfunktionen ---
function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

// Differenz im Bereich (-180, 180]
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

// JS-Date (UTC) -> julday UT
function jdFromUTCDate(swe, d) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return swe.julday(y, m, day, h, swe.SE_GREG_CAL);
}

// Sonne/Mond Längen + Mondphase (Mond - Sonne)
function phaseAngleDeg(swe, tjd_ut) {
  const flag = swe.SEFLG_SWIEPH;
  const sun = swe.calc_ut(tjd_ut, swe.SE_SUN, flag);
  const moon = swe.calc_ut(tjd_ut, swe.SE_MOON, flag);
  const sunLon = sun[0];
  const moonLon = moon[0];
  return norm360(moonLon - sunLon);
}

// Bisection im Intervall [t0, t1] (ms), sucht f(t)=0
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
  if (fa * fb > 0) return null; // kein Vorzeichenwechsel

  for (let i = 0; i < maxIter; i++) {
    const mid = Math.floor((a + b) / 2);
    const fm = fAt(mid);

    // Stop bei <= 1 Sekunde Intervall
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
// CORS / Origin-Allowlist
// -----------------------------
function isAllowedOrigin(origin) {
  if (!origin) return true; // Direkter Browseraufruf ohne Origin (z.B. Tab) zulassen

  const ALLOWED = new Set([
    "https://astrogypsy.de",
    "https://www.astrogypsy.de",
    "https://intern.astrogypsy.de",
    "https://www.intern.astrogypsy.de",

    // Wix/Parastorage (Preview/Editor)
    "https://editor.wix.com",
    "https://www.wix.com",
    "https://manage.wix.com",
    "https://static.parastorage.com",
    "https://static.wixstatic.com",
  ]);

  if (ALLOWED.has(origin)) return true;

  // Wix-Seiten / Wix-Studio Previews (häufige Varianten)
  if (/^https:\/\/.*\.wixsite\.com$/i.test(origin)) return true;
  if (/^https:\/\/.*\.wixstudio\.io$/i.test(origin)) return true;

  return false;
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";

  // Für Debug/Tests im Browser-Tab ohne Origin: keine Allow-Origin setzen
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
    // --- CORS immer zuerst (Wix braucht Preflight) ---
    applyCors(req, res);

    // Preflight
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    // Origin blocken (wenn vorhanden und nicht erlaubt)
    const origin = req.headers.origin || "";
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ ok: false, error: `Origin nicht erlaubt: ${origin}` });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Nur GET erlaubt." });
    }

    // --- Goldstandard-Startcode ---
    const swe = new SwissEph();
    await swe.initSwissEph();
    // --- Ende Goldstandard ---

    /**
     * Erwartete Query-Parameter:
     * birth = ISO mit Zeitzone (wichtig!), z.B. 1999-11-18T20:10:00+01:00
     * year  = Jahr, z.B. 2026   (alternativ: start + end)
     *
     * Optional:
     * start = ISO (UTC oder mit Offset)
     * end   = ISO
     * stepHours = Scan-Schrittweite (Standard 6)
     * tolDeg = Toleranz in Grad für "echter Return" (Standard 0.2)
     */
    const { birth, year, start, end, stepHours, tolDeg } = req.query;

    if (!birth) {
      return res.status(400).json({
        ok: false,
        error:
          "Parameter fehlt: birth (ISO mit Zeitzone), z.B. birth=1999-11-18T20:10:00+01:00",
      });
    }

    const birthDate = parseISOorThrow(birth);

    // Zeitraum festlegen: entweder year oder start/end
    let startDate, endDate;

    if (start && end) {
      startDate = parseISOorThrow(start);
      endDate = parseISOorThrow(end);
    } else {
      if (!year) {
        return res.status(400).json({
          ok: false,
          error: "Parameter fehlt: year ODER (start & end). Beispiel: &year=2026",
        });
      }
      const y = toNumberOrThrow(year, "year");
      // Ganzes Jahr in UTC
      startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    }

    if (endDate <= startDate) {
      return res.status(400).json({ ok: false, error: "end muss nach start liegen." });
    }

    const stepH = stepHours
      ? Math.max(1, Math.min(24, toNumberOrThrow(stepHours, "stepHours")))
      : 6;
    const stepMs = stepH * 60 * 60 * 1000;

    // Toleranz für "echter Return" (Gegenphase wird dadurch ausgeschlossen)
    const tol = tolDeg ? Math.max(0.01, Math.min(5, toNumberOrThrow(tolDeg, "tolDeg"))) : 0.2;

    // Zielwinkel (Mondphase bei Geburt)
    const jdBirth = jdFromUTCDate(swe, birthDate);
    const targetAngle = phaseAngleDeg(swe, jdBirth);

    const fAtDate = (d) => {
      const jd = jdFromUTCDate(swe, d);
      const ang = phaseAngleDeg(swe, jd);
      return { ang, f: signedDiffDeg(ang, targetAngle) }; // f nahe 0 = echter Return
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

      // Root-Kandidat: Vorzeichenwechsel oder exakt 0
      if (prev.f === 0 || cur.f === 0 || prev.f * cur.f < 0) {
        const root = refineRootBisection(swe, tPrev.getTime(), t.getTime(), targetAngle);

        if (root) {
          const r = fAtDate(root);

          // --- WICHTIG: Nur echter Return, keine Gegenphase (±180°) ---
          if (Math.abs(r.f) < tol) {
            // Duplikate vermeiden (falls zwei Intervalle denselben Root treffen)
            const last = returns[returns.length - 1];
            if (
              !last ||
              Math.abs(new Date(last.datetime_utc).getTime() - root.getTime()) > 2 * 60 * 1000
            ) {
              returns.push({
                datetime_utc: root.toISOString(),
                phase_angle_deg: r.ang,
                diff_deg: r.f,
              });
            }
          }
        }
      }

      tPrev = t;
      prev = cur;
    }

    return res.status(200).json({
      ok: true,
      birth_iso_received: birthDate.toISOString(),
      target_phase_angle_deg: targetAngle,
      start_utc: startDate.toISOString(),
      end_utc: endDate.toISOString(),
      step_hours: stepH,
      tolerance_deg: tol,
      count: returns.length,
      returns,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
