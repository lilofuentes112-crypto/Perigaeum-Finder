import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Korrektur für Vercel/GitHub Pages: 
  // Stellt sicher, dass alle Assets relativ vom aktuellen Ordner geladen werden, 
  // um den Rollup-Fehler zu beheben, wenn der Pfad in index.html auf ./src/... gesetzt ist.
  base: './', 
})

