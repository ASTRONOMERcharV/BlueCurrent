import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This workspace commonly runs on a two-core allocation. Spawning one
    // isolated worker per file makes otherwise short CPU simulations exceed
    // their intended timeouts.
    maxWorkers: 2,
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
      // Nested agent worktrees contain verbatim copies of this suite. Running
      // both sets doubles the workload and turns ordinary 5 s tests into
      // timeout failures; the project's own tests remain authoritative.
      '**/.claude/**',
    ],
  },
});
