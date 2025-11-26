import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
--- DATEI: src/types.ts (Definitionen) ---
codeTypeScript
export interface PerigeeEvent {
  date: string;
  distanceKm: string;
  distanceAu: number;
  zodiac: string;
}
export interface PerigeeData {
  planetName: string;
  events: PerigeeEvent[];
  description: string;
}
