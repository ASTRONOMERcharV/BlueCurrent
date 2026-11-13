import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        previewGallery: fileURLToPath(new URL('./preview/index.html', import.meta.url)),
        fishPreview: fileURLToPath(new URL('./preview/fish-preview.html', import.meta.url)),
        predatorPreview: fileURLToPath(new URL('./preview/predator-preview.html', import.meta.url)),
        predatorAnimationPreview: fileURLToPath(new URL('./preview/predator-animation-preview.html', import.meta.url)),
        coralPreview: fileURLToPath(new URL('./preview/coral-preview.html', import.meta.url)),
        kelpPreview: fileURLToPath(new URL('./preview/kelp-preview.html', import.meta.url)),
        seaweedPreview: fileURLToPath(new URL('./preview/seaweed-preview.html', import.meta.url)),
        rocksPreview: fileURLToPath(new URL('./preview/rocks-preview.html', import.meta.url)),
        reefSamplePreview: fileURLToPath(new URL('./preview/reef-sample-preview.html', import.meta.url)),
        reefVariantsPreview: fileURLToPath(new URL('./preview/reef-variants-preview.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples')) return 'three-addons';
          if (id.includes('node_modules/three')) return 'three-core';
        },
      },
    },
  },
});
