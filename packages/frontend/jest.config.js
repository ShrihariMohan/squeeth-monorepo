module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  modulePaths: ['<rootDir>/src'],
  moduleNameMapper: {
    '^src(.*)$': '<rootDir>/src$1',
    '^@utils(.*)$': '<rootDir>/src/utils$1',
    '^@hooks(.*)$': '<rootDir>/src/hooks$1',
  },
}
