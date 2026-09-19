/** @type {import('ts-jest').JestConfigWithTsJest} */
// CommonJS on purpose. The previous jest.config.ts used `export default`, which
// this project's tsconfig rejects under verbatimModuleSyntax when the config is
// loaded as CommonJS, so jest could not even read its own config and the web
// test suite had never run. The backend's jest.config.cjs has the same shape.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\.(ts|tsx)$': ['ts-jest', { tsconfig: './tsconfig.jest.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/__tests__/**/*.(test|spec).ts?(x)'],
  roots: ['<rootDir>/src/lib'],
  // The app imports through the tsconfig '@/' alias; source under test does too.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
