import React, { useState } from 'react';
import { MIN_YEAR, MAX_YEAR } from '../constants';

interface YearInputProps {
  initialYear: number;
  onSearch: (year: number) => void;
  isLoading: boolean;
}

export const YearInput: React.FC<YearInputProps> = ({ initialYear, onSearch, isLoading }) => {
  const [inputValue, setInputValue] = useState<string>(initialYear.toString());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const yearNum = parseInt(inputValue, 10);
    if (!isNaN(yearNum) && yearNum >= MIN_YEAR && yearNum <= MAX_YEAR) {
      onSearch(yearNum);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const isValid = parseInt(inputValue, 10) >= MIN_YEAR && parseInt(inputValue, 10) <= MAX_YEAR;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col sm:flex-row gap-4 items-center justify-center p-6 bg-slate-800/50 rounded-2xl border border-slate-700 shadow-xl backdrop-blur-md">
      <div className="flex-grow w-full relative group">
        <label htmlFor="year" className="absolute -top-2 left-3 bg-slate-800 px-1 text-xs text-cyan-400 font-medium rounded">
          Jahr ({MIN_YEAR}-{MAX_YEAR})
        </label>
        <input
          id="year"
          type="number"
          min={MIN_YEAR}
          max={MAX_YEAR}
          value={inputValue}
          onChange={handleChange}
          disabled={isLoading}
          className={`w-full bg-slate-900/50 border-2 ${isValid ? 'border-slate-600 focus:border-cyan-500' : 'border-red-500'} rounded-lg px-4 py-3 text-lg font-mono tracking-wider outline-none transition-all placeholder-slate-500`}
        />
      </div>
      <button
        type="submit"
        disabled={isLoading || !isValid}
        className="w-full sm:w-auto px-8 py-3.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-lg shadow-cyan-900/20 transition-all flex items-center justify-center gap-2 group"
      >
        {isLoading ? (
          <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
        ) : (
          <>
            Berechnen
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </>
        )}
      </button>
    </form>
  );
};

