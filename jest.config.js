const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './'
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  // Playwright E2E tests live under /e2e and have a separate runner.
  // /.claude/worktrees/ holds in-flight subagent branches with duplicate
  // test files; ignore them too so the main repo's `npm test` doesn't
  // re-run every worktree's copy. /collab-server/ is its own package with
  // its own lockfile + vitest runner (see .github/workflows/ci.yml).
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/', '/.claude/worktrees/', '/collab-server/'],
  // @vercel/analytics and uuid (v14+) ship ESM-only and trip Jest's CJS
  // loader. Stub analytics to a no-op track(); back uuid's v4 with
  // crypto.randomUUID() so tests still get real v4 UUIDs.
  moduleNameMapper: {
    '^@vercel/analytics$': '<rootDir>/jest.stubs/vercel-analytics.js',
    '^@vercel/analytics/next$': '<rootDir>/jest.stubs/vercel-analytics.js',
    '^uuid$': '<rootDir>/jest.stubs/uuid.js',
  },
}

module.exports = createJestConfig(customJestConfig)
