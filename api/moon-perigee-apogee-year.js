// api/moon-perigee-apogee-year.js
// Mond-Perigäen und -Apogäen pro Jahr (nur Datum, deutsch, UTC)
// + Mondphase (Text) pro Ereignis
// + Super-/Mini-Vollmond & Super-/Mini-Neumond (10% Distanzspanne-Regel; Bezug: jeweiliger Perigäum–Apogäum-Zyklus)
// Hinweis: Zeitbasis für Berechnungen/Datumsausgabe = UTC (kann um Mitternacht vom lokalen Kalenderdatum abweichen)

import SwissEph from "swisseph-wasm";

// -------------------- Datum helpers (UTC) --------------------
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

  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;

  return { year, month, day };
}

function formatDateDE({ year, month, day }) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

// -------------------- angle helpers --------------------
function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

// smallest signed diff in degrees: a-b in (-180..180]
function angDiff(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

// -------------------- SwissEph calc helpers --------------------
function getMoonDistAU(swe, jd) {
  const pos = swe.calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
  return pos[2]; // AU
}

function getLonDeg(swe, jd, bodyId) {
  // Swe returns: [lon, lat, dist, ...]
  const pos = swe.calc_ut(jd, bodyId, swe.SEFLG_SWIEPH);
  return pos[0];
}

function getPhaseDeltaDeg(swe, jd) {
  const moonLon = getLonDeg(swe, jd, swe.SE_MOON);
  const sunLon = getLonDeg(swe, jd, swe.SE_SUN);
  return norm360(moonLon - sunLon);
}

function phaseLabelFromDelta(deltaDeg) {
  // deltaDeg in [0..360)
  // tolerance for exact points:
  const tol = 5; // degrees (nur zur Label-Qualität, nicht für Ereignis-Rechnung)

  const d0 = Math.min(deltaDeg, 360 - deltaDeg);
  if (d0 <= tol) return "Neumond";

  const d180 = Math.abs(deltaDeg - 180);
  if (d180 <= tol) return "Vollmond";

  const d90 = Math.abs(deltaDeg - 90);
  if (d90 <= tol) return "Viertelmond zunehmend";

  const d270 = Math.abs(deltaDeg - 270);
  if (d270 <= tol) return "Viertelmond abnehmend";

  // Zwischenphasen
  if (deltaDeg > 0 && deltaDeg < 90) return "Mond zunehmend – 1. Phase";
  if (deltaDeg > 90 && deltaDeg < 180) return "Mond zunehmend – 2. Phase";
  if (deltaDeg > 180 && deltaDeg < 270) return "Mond abnehmend – 1. Phase";
  return "Mond abnehmend – 2. Phase"; // 270..360
}

// -------------------- refinement (extrema) --------------------
// Ternary search on distance (assumes unimodal in small window)
function refineExtremum(swe, jdCenter, kind /* "min"|"max" */) {
  let a = jdCenter - 1.0;
  let b = jdCenter + 1.0;

  // Ensure window is valid
  for (let iter = 0; iter < 40; iter++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    const f1 = getMoonDistAU(swe, m1);
    const f2 = getMoonDistAU(swe, m2);

    if (kind === "min") {
      if (f1 < f2) b = m2;
      else a = m1;
    } else {
      if (f1 > f2) b = m2;
      else a = m1;
    }
  }
  const jd = (a + b) / 2;
  const distAU = getMoonDistAU(swe, jd);
  return { jd, distAU };
}

// -------------------- find New/Full moons in a year --------------------
function findPhaseEventsInYear(swe, jdStart, jdEnd, targetDeg /* 0 or 180 */) {
  // Scan with step to bracket roots of g(jd)=angDiff(delta,target)
  const step = 0.25; // days (6h)
  const events = [];

  let prevJd = jdStart;
  let prevG = angDiff(getPhaseDeltaDeg(swe, prevJd), targetDeg);

  for (let jd = jdStart + step; jd <= jdEnd; jd += step) {
    const g = angDiff(getPhaseDeltaDeg(swe, jd), targetDeg);

    // root bracket if sign change AND not a wrap artifact
    if ((prevG === 0) || (g === 0) || (prevG < 0 && g > 0) || (prevG > 0 && g < 0)) {
      // refine in [prevJd, jd] by bisection on g
      let a = prevJd;
      let b = jd;
      let ga = prevG;
      let gb = g;

      // If both same sign but one is zero-ish, still refine
      for (let iter = 0; iter < 35; iter++) {
        const mid = (a + b) / 2;
        const gm = angDiff(getPhaseDeltaDeg(swe, mid), targetDeg);

        if (Math.abs(gm) < 1e-6) {
          a = b = mid;
          break;
        }

        // choose sub-interval with sign change
        if ((ga < 0 && gm > 0) || (ga > 0 && gm < 0)) {
          b = mid;
          gb = gm;
        } else {
          a = mid;
          ga = gm;
        }
      }

      const jdEvent = (a + b) / 2;

      // De-duplicate: avoid multiple brackets around the same event
      if (events.length === 0 || Math.abs(jdEvent - events[events.length - 1].jd) > 0.3) {
        events.push({ jd: jdEvent });
      }
    }

    prevJd = jd;
    prevG = g;
  }

  return events;
}

// -------------------- cycle matching for 10% rule --------------------
function findNearestIndexByJd(list, jd) {
  // list: [{jd, ...}] sorted
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid].jd;
    if (v < jd) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is insertion point
  const i1 = Math.max(0, Math.min(list.length - 1, lo));
  const i0 = Math.max(0, i1 - 1);
  return (Math.abs(list[i1].jd - jd) < Math.abs(list[i0].jd - jd)) ? i1 : i0;
}

function findPrevNext(list, jd) {
  // returns {prevIndex, nextIndex} where prev.jd <= jd < next.jd (best effort)
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].jd <= jd) lo = mid + 1;
    else hi = mid - 1;
  }
  const prevIndex = Math.max(0, Math.min(list.length - 1, hi));
  const nextIndex = Math.max(0, Math.min(list.length - 1, hi + 1));
  return { prevIndex, nextIndex };
}

export default async function handler(req, res) {
  // CORS (wie bisher) – für Wix-Embed ok
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

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

    // Jahr etwas überlappend abdecken (UTC)
    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0);
    const days = Math.floor(jdEnd - jdStart);

    // --- 1) Grob finden (Trendwechsel, Tagesraster) ---
    const perigeesRaw = [];
    const apogeesRaw = [];

    let prevDist = null;
    let prevTrend = null; // -1 fallend, +1 steigend

    for (let i = 0; i <= days; i++) {
      const jd = jdStart + i;
      const dist = getMoonDistAU(swe, jd);

      if (prevDist !== null) {
        const trend = dist > prevDist ? +1 : -1;

        // Minimum (Perigäum): Trend -1 -> +1
        if (prevTrend === -1 && trend === +1) {
          const jdApprox = jd - 1;
          if (jdApprox >= jdStart && jdApprox < jdEnd) perigeesRaw.push({ jdApprox });
        }

        // Maximum (Apogäum): Trend +1 -> -1
        if (prevTrend === +1 && trend === -1) {
          const jdApprox = jd - 1;
          if (jdApprox >= jdStart && jdApprox < jdEnd) apogeesRaw.push({ jdApprox });
        }

        prevTrend = trend;
      }
      prevDist = dist;
    }

    // --- 2) Verfeinern (bessere JD/Distanz) ---
    const perigees = perigeesRaw.map(x => {
      const refined = refineExtremum(swe, x.jdApprox, "min");
      const cal = jdToCalendar(refined.jd);
      const delta = getPhaseDeltaDeg(swe, refined.jd);
      return {
        jd: refined.jd,
        distAU: refined.distAU,
        datum: formatDateDE(cal),
        phase: phaseLabelFromDelta(delta),
        notes: []
      };
    }).sort((a,b)=>a.jd-b.jd);

    const apogees = apogeesRaw.map(x => {
      const refined = refineExtremum(swe, x.jdApprox, "max");
      const cal = jdToCalendar(refined.jd);
      const delta = getPhaseDeltaDeg(swe, refined.jd);
      return {
        jd: refined.jd,
        distAU: refined.distAU,
        datum: formatDateDE(cal),
        phase: phaseLabelFromDelta(delta),
        notes: []
      };
    }).sort((a,b)=>a.jd-b.jd);

    // Falls Randfälle: sicherstellen, dass wir genug Paare haben
    // (Für 10%-Regel brauchen wir Perigäum und Apogäum in zeitlicher Nähe.)
    // --- 3) Neu-/Vollmonde des Jahres finden (exakt in JD, UTC) ---
    const newMoons = findPhaseEventsInYear(swe, jdStart, jdEnd, 0);
    const fullMoons = findPhaseEventsInYear(swe, jdStart, jdEnd, 180);

    // --- 4) Super/Mini Klassifikation nach 10% Distanzspanne pro Zyklus ---
    // Helper: classify one event (jdEvent) as Super/Mini based on nearest cycle.
    function classifyEvent(jdEvent) {
      const distEvent = getMoonDistAU(swe, jdEvent);

      // Find surrounding perigee and apogee indices
      const { prevIndex: pPrev, nextIndex: pNext } = findPrevNext(perigees, jdEvent);
      const { prevIndex: aPrev, nextIndex: aNext } = findPrevNext(apogees, jdEvent);

      // Choose "cycle pair" that is closest in time and makes sense:
      // We'll pick nearest perigee and nearest apogee, then build span from the closest bracketing pair.
      const pNear = findNearestIndexByJd(perigees, jdEvent);
      const aNear = findNearestIndexByJd(apogees, jdEvent);

      // Build a candidate span using the nearest perigee and nearest apogee.
      // If apogee occurs before perigee, that's OK; span = apogeeDist - perigeeDist in same neighborhood.
      const per = perigees[pNear];
      const apo = apogees[aNear];

      // If we accidentally picked a very distant partner (e.g. year edge),
      // we try a closer bracketing apogee around this perigee:
      let perUse = per;
      let apoUse = apo;

      // Try to pick the apogee that is closest to the perigee in time
      // among aPrev/aNext if available
      const apoCandidates = [];
      if (apogees[aPrev]) apoCandidates.push(apogees[aPrev]);
      if (apogees[aNext]) apoCandidates.push(apogees[aNext]);

      if (apoCandidates.length) {
        apoCandidates.sort((x, y) => Math.abs(x.jd - perUse.jd) - Math.abs(y.jd - perUse.jd));
        apoUse = apoCandidates[0];
      }

      // Similarly, pick perigee close to apogee
      const perCandidates = [];
      if (perigees[pPrev]) perCandidates.push(perigees[pPrev]);
      if (perigees[pNext]) perCandidates.push(perigees[pNext]);
      if (perCandidates.length) {
        perCandidates.sort((x, y) => Math.abs(x.jd - apoUse.jd) - Math.abs(y.jd - apoUse.jd));
        perUse = perCandidates[0];
      }

      const span = Math.abs(apoUse.distAU - perUse.distAU);
      if (!(span > 0)) return { kind: "normal", distEvent, perUse, apoUse, span };

      const perThreshold = perUse.distAU + 0.10 * span; // within inner 10% near perigee
      const apoThreshold = apoUse.distAU - 0.10 * span; // within inner 10% near apogee

      let kind = "normal";
      // Determine which is max/min (sanity)
      const distMin = Math.min(perUse.distAU, apoUse.distAU);
      const distMax = Math.max(perUse.distAU, apoUse.distAU);

      // If perUse is actually the min, use perThreshold logic; else swap logic conservatively
      if (perUse.distAU <= apoUse.distAU) {
        if (distEvent <= perThreshold) kind = "super"; // near perigee
        else if (distEvent >= apoThreshold) kind = "mini"; // near apogee
      } else {
        // Rare if pairing swapped; use symmetric rules around min/max
        const thrNearMin = distMin + 0.10 * (distMax - distMin);
        const thrNearMax = distMax - 0.10 * (distMax - distMin);
        if (distEvent <= thrNearMin) kind = "super";
        else if (distEvent >= thrNearMax) kind = "mini";
      }

      return { kind, distEvent, perUse, apoUse, span };
    }

    // Prepare helper to attach note to nearest perigee/apogee
    function attachNoteToNearest(list, jd, note) {
      if (!list.length) return;
      const idx = findNearestIndexByJd(list, jd);
      // Avoid duplicates
      if (!list[idx].notes.includes(note)) list[idx].notes.push(note);
    }

    function jdToDateStr(jd) {
      return formatDateDE(jdToCalendar(jd));
    }

    // For each event, classify and attach note to relevant extremum list
    for (const ev of newMoons) {
      const cls = classifyEvent(ev.jd);
      const dateStr = jdToDateStr(ev.jd);

      if (cls.kind === "super") {
        attachNoteToNearest(
          perigees,
          ev.jd,
          `Super-Neumond am ${dateStr} (liegt im 10%-Bereich der Distanzspanne)`
        );
      } else if (cls.kind === "mini") {
        attachNoteToNearest(
          apogees,
          ev.jd,
          `Mini-Neumond am ${dateStr} (liegt im 10%-Bereich der Distanzspanne)`
        );
      }
    }

    for (const ev of fullMoons) {
      const cls = classifyEvent(ev.jd);
      const dateStr = jdToDateStr(ev.jd);

      if (cls.kind === "super") {
        attachNoteToNearest(
          perigees,
          ev.jd,
          `Super-Vollmond am ${dateStr} (liegt im 10%-Bereich der Distanzspanne)`
        );
      } else if (cls.kind === "mini") {
        attachNoteToNearest(
          apogees,
          ev.jd,
          `Mini-Vollmond am ${dateStr} (liegt im 10%-Bereich der Distanzspanne)`
        );
      }
    }

    // Output: keep compatibility but add phase + notes
    return res.status(200).json({
      ok: true,
      year,
      meta: {
        timeBasis: "UTC",
        superMiniRule: "Neu-/Vollmond im innersten 10%-Bereich der jeweiligen Distanzspanne zwischen Perigäum und Apogäum (pro Zyklus)."
      },
      counts: {
        perigee: perigees.length,
        apogee: apogees.length
      },
      perigees: perigees.map(p => ({
        datum: p.datum,
        phase: p.phase,
        notes: p.notes
      })),
      apogees: apogees.map(a => ({
        datum: a.datum,
        phase: a.phase,
        notes: a.notes
      }))
    });
  } catch (e) {
    console.error("Mond-Perigäum/Apogäum-Fehler:", e);
    return res.status(500).json({
      ok: false,
      error: String(e)
    });
  } finally {
    try {
      swe.close();
    } catch (_) {
      // ignorieren
    }
  }
}
