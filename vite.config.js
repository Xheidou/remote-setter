import {defineConfig} from 'vite';

// base relative : le site fonctionne aussi bien à la racine d'un domaine que sous /<dépôt>/ (GitHub Pages)
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900
  }
});
