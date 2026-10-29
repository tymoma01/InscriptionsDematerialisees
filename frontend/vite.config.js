import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // tesseract.js charge un modèle d'OCR à l'adresse « {dossier}/{langue}.traineddata.gz » :
        // le nom haché garde cette fin (voir src/core/pieceJustificative/ocr/ocr.js).
        assetFileNames: (asset) => {
          const modele = asset.names?.find((nom) => nom.endsWith('.traineddata.gz'));
          return modele ? `assets/${modele.replace('.traineddata.gz', '')}-[hash].traineddata.gz` : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
