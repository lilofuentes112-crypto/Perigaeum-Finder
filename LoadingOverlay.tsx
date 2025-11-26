import React from 'react';

export const LoadingOverlay: React.FC = () => {
  return (
    <div className="w-full h-64 flex flex-col items-center justify-center gap-4 text-cyan-400">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-slate-700 rounded-full"></div>
        <div className="absolute top-0 left-0 w-full h-full border-4 border-cyan-500 rounded-full border-t-transparent animate-spin"></div>
        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white rounded-full transform -translate-x-1/2 -translate-y-1/2 animate-pulse"></div>
      </div>
      <p className="text-slate-300 font-medium animate-pulse">Berechne Planetenbahnen...</p>
    </div>
  );
};

