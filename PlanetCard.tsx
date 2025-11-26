import React from 'react';
import { PerigeeData } from '../types';
import { PLANET_COLORS } from '../constants';

interface PlanetCardProps {
  data: PerigeeData;
}

export const PlanetCard: React.FC<PlanetCardProps> = ({ data }) => {
  const gradient = PLANET_COLORS[data.planetName] || "from-gray-500 to-gray-700";
  const hasEvents = data.events && data.events.length > 0;

  return (
    <div className="relative group h-full">
      <div className={`absolute -inset-0.5 bg-gradient-to-br ${gradient} rounded-2xl opacity-30 group-hover:opacity-75 blur transition duration-500`}></div>
      <div className="relative h-full flex flex-col bg-slate-900 border border-slate-700/50 rounded-2xl p-5 md:p-6 overflow-hidden hover:border-slate-600 transition-colors">
        
        {/* Decorative Element */}
        <div className={`absolute -right-6 -top-6 w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br ${gradient} opacity-20 blur-xl`}></div>
        
        <div className="flex justify-between items-start mb-4 z-10">
          <h3 className="text-xl md:text-2xl font-bold text-white tracking-wide">{data.planetName}</h3>
          <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-br ${gradient} shadow-inner`}></div>
        </div>

        <div className="flex-grow z-10 space-y-4">
          {!hasEvents ? (
             <div className="flex items-center justify-center h-16 md:h-20">
               <p className="text-slate-500 italic text-center text-sm md:text-base">{data.description}</p>
             </div>
          ) : (
            <div className="space-y-2 md:space-y-3">
              {data.events.map((event, idx) => (
                <div key={idx} className="bg-slate-800/50 rounded-lg p-2.5 md:p-3 border border-slate-700/50">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-cyan-300 font-bold font-mono text-base md:text-lg">{event.date}</span>
                    <span className="text-xs text-slate-400 font-medium">{event.zodiac}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] md:text-xs text-slate-500 uppercase tracking-wider">Distanz</span>
                    <span className="text-xs md:text-sm text-slate-200 font-mono">{event.distanceKm}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {hasEvents && (
           <div className="pt-3 md:pt-4 mt-2 border-t border-slate-800 z-10">
              <p className="text-[10px] md:text-xs text-slate-400 leading-relaxed italic text-center">
               {data.description}
             </p>
           </div>
        )}
      </div>
    </div>
  );
};

