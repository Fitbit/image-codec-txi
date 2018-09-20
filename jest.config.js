module.exports = {
  transform: {
    '^.+\\.(ts|js)$': 'ts-jest',
  },
  moduleFileExtensions: [
    'ts',
    'js',
  ],
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.(ts|js)$',
  testPathIgnorePatterns: [
    '<rootDir>/node_modules',
    '<rootDir>/dist',
    '<rootDir>/lib',
    '<rootDir>/mod',
  ],
  testEnvironment: 'node',
  coverageDirectory: "<rootDir>/coverage",
  collectCoverage: true,
  collectCoverageFrom: [
    "src/**/*.ts",
  ],
};
