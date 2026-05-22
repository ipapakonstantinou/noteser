const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './'
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  // Playwright E2E tests live under /e2e and have a separate runner.
  // Note: the /.claude/worktrees/ exclusion is intentionally absent here —
  // this jest.config.js IS inside a worktree, so we must not exclude ourselves.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
}

module.exports = createJestConfig(customJestConfig)
