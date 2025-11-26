DATEI: src/services/geminiService.ts (Mathematik & Logik) ---
codeTypeScript
import { GeoVector, Ecliptic, Body } from "astronomy-engine";
import { PerigeeData, PerigeeEvent } from "../types";

const BODY_MAP: Record<string, Body> = {
  "Merkur": Body.Mercury, "Venus": Body.Venus, "Mars": Body.Mars,
  "Jupiter": Body.Jupiter, "Saturn": Body.Saturn, "Uranus": Body.Uranus,
  "Neptun": Body.Neptune, "Pluto": Body.Pluto
};

const SE_CHIRON = 15;
const SE_GREG_CAL = 1;
const SEFLG_SWIEPH = 2;
const SEFLG_SPEED = 256;

const vectorLength = (v: any) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);

const getZodiacSign = (longitude: number): string => {
  const signs = ["Widder", "Stier", "Zwillinge", "Krebs", "Löwe", "Jungfrau", "Waage", "Skorpion", "Schütze", "Steinbock", "Wassermann", "Fische"];
  let lon = longitude % 360;
  if (lon < 0) lon += 360;
  return signs[Math.floor(lon / 30)];
};

const formatDate = (date: Date) => date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

// CHIRON (Swiss Ephemeris)
const calculateChironPerigee = async (year: number): Promise<PerigeeData | null> => {
  try {
    const module = await import("https://esm.sh/swisseph-wasm@1.0.1");
    const SwissEph = module.default || module.SwissEph || module;
    const swe = new SwissEph();
    const init = swe.initSwissEph();
    if (init instanceof Promise) await init.catch(() => {});

    const distances: number[] = [];
    const days = 365 + (year % 4 === 0 ? 1 : 0);
    for (let d = 0; d <= days; d++) {
        const tjd = swe.julday(year, 1, d + 1, 12, SE_GREG_CAL);
        const res = swe.calc_ut(tjd, SE_CHIRON, SEFLG_SWIEPH | SEFLG_SPEED);
        distances.push(res.xx[2]); 
    }

    let foundIndex = -1;
    let foundDist = Infinity;
    for (let i = 1; i < distances.length - 1; i++) {
        if (distances[i] < distances[i-1] && distances[i] < distances[i+1]) {
            if (distances[i] < foundDist) {
                foundDist = distances[i];
                foundIndex = i;
            }
        }
    }

    const events: PerigeeEvent[] = [];
    if (foundIndex !== -1) {
        const date = new Date(Date.UTC(year, 0, foundIndex + 1, 12));
        const tjd = swe.julday(year, 1, foundIndex + 1, 12, SE_GREG_CAL);
        const res = swe.calc_ut(tjd, SE_CHIRON, SEFLG_SWIEPH | SEFLG_SPEED);
        const distKm = (foundDist * 149597870.7).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " km";
        events.push({ date: formatDate(date), distanceAu: foundDist, distanceKm: distKm, zodiac: getZodiacSign(res.xx[0]) });
    }
    return { planetName: "Chiron", events, description: events.length > 0 ? "Opposition (Rückläufig)" : "Kein Perigäum" };
  } catch (e) { return { planetName: "Chiron", events: [], description: "Fehler (SwissEph)" }; }
};

// STANDARD PLANETS (Astronomy Engine)
const calculatePlanetPerigee = (planetName: string, year: number): PerigeeData | null => {
  try {
    const bodyName = BODY_MAP[planetName];
    if (!bodyName) return null;
    const events: PerigeeEvent[] = [];
    const dists: { dist: number, time: Date }[] = [];
    
    for (let d = -2; d <= 368; d++) {
        const date = new Date(Date.UTC(year, 0, 1 + d, 0));
        const v = GeoVector(bodyName, date, true);
        dists.push({ dist: vectorLength(v), time: date });
    }

    for (let i = 1; i < dists.length - 1; i++) {
        if (dists[i].dist < dists[i-1].dist && dists[i].dist < dists[i+1].dist) {
            if (dists[i].time.getUTCFullYear() === year) {
                let bestHourDist = Infinity;
                let bestHourDate = dists[i].time;
                for (let h = -12; h <= 36; h++) {
                    const hDate = new Date(dists[i].time.getTime() + h * 3600000);
                    const v = GeoVector(bodyName, hDate, true);
                    const d = vectorLength(v);
                    if (d < bestHourDist) { bestHourDist = d; bestHourDate = hDate; }
                }

                if ((planetName === "Merkur" || planetName === "Venus") && bestHourDist > 0.8) continue;

                const finalVector = GeoVector(bodyName, bestHourDate, true);
                const ecliptic = Ecliptic(finalVector);
                const distKm = (bestHourDist * 149597870.7).toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " km";
                events.push({ date: formatDate(bestHourDate), distanceAu: bestHourDist, distanceKm: distKm, zodiac: getZodiacSign(ecliptic.elon) });
            }
        }
    }
    
    let description = events.length === 0 ? "Kein Perigäum (Zyklus > 1 Jahr)" : ((planetName === "Merkur" || planetName === "Venus") ? "Untere Konjunktion (Rückläufig)" : "Opposition (Rückläufig)");
    return { planetName, events, description };
  } catch (e: any) { return { planetName, events: [], description: "Fehler" }; }
};

export const fetchPerigeeData = async (year: number): Promise<PerigeeData[]> => {
  const planets = ["Merkur", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptun", "Pluto"];
  const calculatedData = [];
  for (const p of planets) { const res = calculatePlanetPerigee(p, year); if(res) calculatedData.push(res); }
  const chiron = await calculateChironPerigee(year);
  if (chiron) calculatedData.push(chiron);
  const order = ["Merkur", "Venus", "Mars", "Jupiter", "Saturn", "Chiron", "Uranus", "Neptun", "Pluto"];
  return calculatedData.sort((a, b) => order.indexOf(a.planetName) - order.indexOf(b.planetName));
};

