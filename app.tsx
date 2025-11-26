App.tsx

import React, { useState, useCallback, useEffect } from 'react';
import { PerigeeData } from './types';
import { fetchPerigeeData } from './services/geminiService';
import { PlanetGrid } from './components/PlanetGrid';
import { YearInput } from './components/YearInput';
import { LoadingOverlay } from './components/LoadingOverlay';
import { Header } from './components/Header';
import { ErrorBanner } from './components/ErrorBanner';

const App: React.FC = () => {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<PerigeeData[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isEmbedded, setIsEmbedded] = useState<boolean>(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsEmbedded(params.get('embed') === 'true');
  }, []);

  const handleSearch = useCallback(async (selectedYear: number) => {
    setLoading(true);
    setError(null);
    setData(null);
    setYear(selectedYear);

    try {
      const result = await fetchPerigeeData(selectedYear);
      setData(result);
    } catch (err) {
      console.error(err);
      setError("Es gab ein Problem bei der Berechnung der astronomischen Daten.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Styles für den normalen Modus vs. Embed-Modus
  // Embed-Modus erzwingt bg-slate-900, damit weißer Text auf weißen Webseiten lesbar bleibt.
  const containerClasses = isEmbedded 
    ? "min-h-screen bg-slate-900 text-slate-100 font-sans overflow-x-hidden"
    : "min-h-screen bg-[url('https://picsum.photos/id/903/1920/1080?grayscale&blur=2')] bg-cover bg-fixed bg-center text-slate-100 selection:bg-cyan-500 selection:text-white font-sans overflow-x-hidden";

  const contentWrapperClasses = isEmbedded
    ? "min-h-screen flex flex-col w-full"
    : "min-h-screen bg-slate-900/80 backdrop-blur-sm flex flex-col w-full";

  return (
    <div className={containerClasses}>
      <div className={contentWrapperClasses}>
        
        {!isEmbedded && <Header />}

        <main className={`flex-grow container mx-auto px-4 ${isEmbedded ? 'py-4 max-w-full' : 'py-8 max-w-6xl'}`}>
          <div className="flex flex-col items-center gap-6 mb-8">
            <div className="max-w-2xl text-center space-y-3">
              {!isEmbedded && (
                <h2 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                  Perigäum Finder
                </h2>
              )}
              <p className={`text-slate-300 ${isEmbedded ? 'text-sm md:text-base' : 'text-lg'}`}>
                {isEmbedded 
                  ? "Berechnen Sie Perigäums-Daten für Planeten & Chiron." 
                  : "Ermitteln Sie die genauen Daten der Erdnähe (Perigäum) für Planeten und Chiron."}
              </p>
            </div>

            <YearInput 
              initialYear={year} 
              onSearch={handleSearch} 
              isLoading={loading} 
            />
          </div>

          {error && <ErrorBanner message={error} />}

          {loading && <LoadingOverlay />}

          {!loading && !error && data && (
            <PlanetGrid data={data} year={year} />
          )}

          {!loading && !error && !data && (
            <div className="text-center text-slate-500 mt-10 md:mt-20 px-4">
              <p className="text-sm md:text-base">Geben Sie eine Jahreszahl ein, um die Berechnung zu starten.</p>
            </div>
          )}
        </main>

        {/* Footer: Expliziter Copyright-Hinweis als "Stufe 1" Schutz */}
        <footer className={`border-t border-slate-800 bg-slate-950/50 py-6 text-center text-slate-500 text-xs md:text-sm px-4 ${isEmbedded ? 'pb-2 pt-4' : ''}`}>
          <p className="mb-1">© {new Date().getFullYear()} Urheberrechtlich geschützt. Alle Rechte vorbehalten.</p>
          <p className="opacity-60 text-[10px]">Berechnung basierend auf Swiss Ephemeris & Astronomy Engine (VSOP87).</p>
        </footer>
      </div>
    </div>
  );
};

export default App;

