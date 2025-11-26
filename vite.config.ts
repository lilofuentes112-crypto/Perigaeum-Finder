import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Füge diese Zeile hinzu, um sicherzustellen, 
  // dass alle Assets relativ vom aktuellen Ordner geladen werden
  base: './', 
})

