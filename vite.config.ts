import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        fishPreview: fileURLToPath(new URL('./fish-preview.html', import.meta.url)),
        predatorPreview: fileURLToPath(new URL('./predator-preview.html', import.meta.url)),
        predatorAnimationPreview: fileURLToPath(new URL('./predator-animation-preview.html', import.meta.url)),
        coralPreview: fileURLToPath(new URL('./coral-preview.html', import.meta.url)),
        kelpPreview: fileURLToPath(new URL('./kelp-preview.html', import.meta.url)),
        seaweedPreview: fileURLToPath(new URL('./seaweed-preview.html', import.meta.url)),
        rocksPreview: fileURLToPath(new URL('./rocks-preview.html', import.meta.url)),
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
