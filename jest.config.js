const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './'
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  // Playwright E2E tests live under /e2e and have a separate runner.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
}

module.exports = createJestConfig(customJestConfig)
