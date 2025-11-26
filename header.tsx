import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="p-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/30"></div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            Astro<span className="text-cyan-400">Log</span>
          </h1>
        </div>
        <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-400">
          <span className="hover:text-cyan-400 cursor-pointer transition-colors">Planeten</span>
          <span className="hover:text-cyan-400 cursor-pointer transition-colors">Ephemeriden</span>
          <span className="hover:text-cyan-400 cursor-pointer transition-colors">Info</span>
        </nav>
      </div>
    </header>
  );
};

