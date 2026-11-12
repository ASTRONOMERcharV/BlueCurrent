import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.task-locks/backups` keeps verbatim rollback copies of tests; they are
    // bookkeeping, not a second test suite, and must never be discovered by
    // `npm test`. Default excludes are kept and only the relay folder is added.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/.task-locks/**',
    ],
  },
});
