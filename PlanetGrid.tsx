import React from 'react';
import { PerigeeData } from '../types';
import { PlanetCard } from './PlanetCard';

interface PlanetGridProps {
  data: PerigeeData[];
  year: number;
}

export const PlanetGrid: React.FC<PlanetGridProps> = ({ data, year }) => {
  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <h3 className="text-xl font-semibold text-slate-300">
          Ergebnisse für das Jahr <span className="text-cyan-400 font-mono">{year}</span>
        </h3>
        <span className="text-xs text-slate-500 hidden sm:inline-block">Daten: Gold Standard (SwissEph/VSOP87)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
        {data.map((planet) => (
          <PlanetCard key={planet.planetName} data={planet} />
        ))}
      </div>
    </div>
  );
};

