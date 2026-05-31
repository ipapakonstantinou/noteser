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
  // re-run every worktree's copy.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/', '/.claude/worktrees/'],
  // @vercel/analytics ships ESM-only and trips Jest's CJS loader. Tests
  // never need real analytics calls; stub the module to a no-op track().
  moduleNameMapper: {
    '^@vercel/analytics$': '<rootDir>/jest.stubs/vercel-analytics.js',
    '^@vercel/analytics/next$': '<rootDir>/jest.stubs/vercel-analytics.js',
  },
}

module.exports = createJestConfig(customJestConfig)
