// api/moon-perigee-apogee-year.js
// Mond-Perigäen und -Apogäen pro Jahr (Datum, UTC) + Mondphase-Text
// + Super-/Mini-Vollmond & Super-/Mini-Neumond (10%-Distanzspanne-Regel; UTC-Datum)

import SwissEph from "swisseph-wasm";

// ---------- Datum helpers (UTC) ----------
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

// ---------- Angle helpers ----------
function norm360(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

function getLonDeg(swe, jd, bodyId) {
  const pos = swe.calc_ut(jd, bodyId, swe.SEFLG_SWIEPH);
  return pos[0];
}

function getMoonDistAU(swe, jd) {
  const pos = swe.calc_ut(jd, swe.SE_MOON, swe.SEFLG_SWIEPH);
  return pos[2]; // AU
}

function getPhaseDeltaDeg(swe, jd) {
  const moonLon = getLonDeg(swe, jd, swe.SE_MOON);
  const sunLon = getLonDeg(swe, jd, swe.SE_SUN);
  return norm360(moonLon - sunLon);
}

function phaseLabelFromDelta(deltaDeg) {
  const tol = 5; // nur Label-Qualität
  const d0 = Math.min(deltaDeg, 360 - deltaDeg);
  if (d0 <= tol) return "Neumond";
  const d180 = Math.abs(deltaDeg - 180);
  if (d180 <= tol) return "Vollmond";
  const d90 = Math.abs(deltaDeg - 90);
  if (d90 <= tol) return "Viertelmond zunehmend";
  const d270 = Math.abs(deltaDeg - 270);
  if (d270 <= tol) return "Viertelmond abnehmend";

  if (deltaDeg > 0 && deltaDeg < 90) return "Mond zunehmend – 1. Phase";
  if (deltaDeg > 90 && deltaDeg < 180) return "Mond zunehmend – 2. Phase";
  if (deltaDeg > 180 && deltaDeg < 270) return "Mond abnehmend – 1. Phase";
  return "Mond abnehmend – 2. Phase";
}

// ---------- Refinement helpers ----------
function refineExtremumDistance(swe, jdCenter, kind /* "min"|"max" */) {
  // ternary search in +/- 1 day window
  let a = jdCenter - 1.0;
  let b = jdCenter + 1.0;

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

const RAD = Math.PI / 180;

// Smooth distance-to-phase measures (avoid 0/360 discontinuity):
// New moon: delta=0 -> value 0. Full moon: delta=180 -> value 0.
function phaseMetricNew(swe, jd) {
  const d = getPhaseDeltaDeg(swe, jd);
  return 1 - Math.cos(d * RAD);
}
function phaseMetricFull(swe, jd) {
  const d = getPhaseDeltaDeg(swe, jd);
  return 1 + Math.cos(d * RAD);
}

function refinePhaseMinimum(swe, jdCenter, which /* "new"|"full" */) {
  let a = jdCenter - 1.0;
  let b = jdCenter + 1.0;
  const metric = which === "new" ? phaseMetricNew : phaseMetricFull;

  for (let iter = 0; iter < 45; iter++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    const f1 = metric(swe, m1);
    const f2 = metric(swe, m2);
    if (f1 < f2) b = m2;
    else a = m1;
  }
  return { jd: (a + b) / 2 };
}

// Find minima of phase metric by scanning and detecting trend changes
function findPhaseEventsInYear(swe, jdStart, jdEnd, which /* "new"|"full" */) {
  const metric = which === "new" ? phaseMetricNew : phaseMetricFull;
  const step = 0.25; // 6h
  const events = [];

  let prev = metric(swe, jdStart);
  let prevDiff = null;

  for (let jd = jdStart + step; jd <= jdEnd; jd += step) {
    const cur = metric(swe, jd);
    const diff = cur - prev;

    if (prevDiff !== null) {
      // minimum occurs when slope changes from negative to positive
      if (prevDiff < 0 && diff > 0) {
        const approx = jd - step; // around turning point
        const refined = refinePhaseMinimum(swe, approx, which);

        // de-dup: new/full are ~29.5 days apart each; keep 10-day separation safe
        if (!events.length || Math.abs(refined.jd - events[events.length - 1].jd) > 10) {
          events.push({ jd: refined.jd });
        }
      }
    }

    prevDiff = diff;
    prev = cur;
  }

  return events;
}

// ---------- Cycle pairing helpers ----------
function findNearestIndexByJd(list, jd) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid].jd;
    if (v < jd) lo = mid + 1;
    else hi = mid - 1;
  }
  const i1 = Math.max(0, Math.min(list.length - 1, lo));
  const i0 = Math.max(0, i1 - 1);
  return Math.abs(list[i1].jd - jd) < Math.abs(list[i0].jd - jd) ? i1 : i0;
}

function findPrevNext(list, jd) {
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

function jdToDateStr(jd) {
  return formatDateDE(jdToCalendar(jd));
}

export default async function handler(req, res) {
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

    const jdStart = swe.julday(year, 1, 1, 0.0);
    const jdEnd = swe.julday(year + 1, 1, 2, 0.0);
    const days = Math.floor(jdEnd - jdStart);

    // --- 1) Approx Perigee/Apogee by trend change (daily) ---
    const perigeesRaw = [];
    const apogeesRaw = [];

    let prevDist = null;
    let prevTrend = null;

    for (let i = 0; i <= days; i++) {
      const jd = jdStart + i;
      const dist = getMoonDistAU(swe, jd);

      if (prevDist !== null) {
        const trend = dist > prevDist ? +1 : -1;

        if (prevTrend === -1 && trend === +1) {
          const jdApprox = jd - 1;
          if (jdApprox >= jdStart && jdApprox < jdEnd) perigeesRaw.push({ jdApprox });
        }
        if (prevTrend === +1 && trend === -1) {
          const jdApprox = jd - 1;
          if (jdApprox >= jdStart && jdApprox < jdEnd) apogeesRaw.push({ jdApprox });
        }

        prevTrend = trend;
      }
      prevDist = dist;
    }

    // --- 2) Refine extrema ---
    const perigees = perigeesRaw
      .map(x => {
        const r = refineExtremumDistance(swe, x.jdApprox, "min");
        const cal = jdToCalendar(r.jd);
        const delta = getPhaseDeltaDeg(swe, r.jd);
        return {
          jd: r.jd,
          distAU: r.distAU,
          datum: formatDateDE(cal),
          phase: phaseLabelFromDelta(delta),
          notes: []
        };
      })
      .sort((a, b) => a.jd - b.jd);

    const apogees = apogeesRaw
      .map(x => {
        const r = refineExtremumDistance(swe, x.jdApprox, "max");
        const cal = jdToCalendar(r.jd);
        const delta = getPhaseDeltaDeg(swe, r.jd);
        return {
          jd: r.jd,
          distAU: r.distAU,
          datum: formatDateDE(cal),
          phase: phaseLabelFromDelta(delta),
          notes: []
        };
      })
      .sort((a, b) => a.jd - b.jd);

    // --- 3) Find real New/Full moons (smooth minima) ---
    const newMoons = findPhaseEventsInYear(swe, jdStart, jdEnd, "new");
    const fullMoons = findPhaseEventsInYear(swe, jdStart, jdEnd, "full");

    // --- 4) 10%-rule classification (per cycle neighborhood) ---
    function classifyEvent(jdEvent) {
      const distEvent = getMoonDistAU(swe, jdEvent);

      const { prevIndex: pPrev, nextIndex: pNext } = findPrevNext(perigees, jdEvent);
      const { prevIndex: aPrev, nextIndex: aNext } = findPrevNext(apogees, jdEvent);

      let perUse = perigees[findNearestIndexByJd(perigees, jdEvent)];
      let apoUse = apogees[findNearestIndexByJd(apogees, jdEvent)];

      // choose closer pairing around each other
      const apoCandidates = [];
      if (apogees[aPrev]) apoCandidates.push(apogees[aPrev]);
      if (apogees[aNext]) apoCandidates.push(apogees[aNext]);
      if (apoCandidates.length) {
        apoCandidates.sort((x, y) => Math.abs(x.jd - perUse.jd) - Math.abs(y.jd - perUse.jd));
        apoUse = apoCandidates[0];
      }

      const perCandidates = [];
      if (perigees[pPrev]) perCandidates.push(perigees[pPrev]);
      if (perigees[pNext]) perCandidates.push(perigees[pNext]);
      if (perCandidates.length) {
        perCandidates.sort((x, y) => Math.abs(x.jd - apoUse.jd) - Math.abs(y.jd - apoUse.jd));
        perUse = perCandidates[0];
      }

      const span = Math.abs(apoUse.distAU - perUse.distAU);
      if (!(span > 0)) return { kind: "normal", distEvent };

      const distMin = Math.min(perUse.distAU, apoUse.distAU);
      const distMax = Math.max(perUse.distAU, apoUse.distAU);

      const thrNearMin = distMin + 0.10 * (distMax - distMin);
      const thrNearMax = distMax - 0.10 * (distMax - distMin);

      if (distEvent <= thrNearMin) return { kind: "super", distEvent };
      if (distEvent >= thrNearMax) return { kind: "mini", distEvent };
      return { kind: "normal", distEvent };
    }

    function attachNoteToNearest(list, jd, note) {
      if (!list.length) return;
      const idx = findNearestIndexByJd(list, jd);
      if (!list[idx].notes.includes(note)) list[idx].notes.push(note);
    }

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

    return res.status(200).json({
      ok: true,
      year,
      meta: {
        timeBasis: "UTC",
        superMiniRule:
          "Neu-/Vollmond im innersten 10%-Bereich der jeweiligen Distanzspanne zwischen Perigäum und Apogäum (pro Zyklus)."
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
    try { swe.close(); } catch (_) {}
  }
}
