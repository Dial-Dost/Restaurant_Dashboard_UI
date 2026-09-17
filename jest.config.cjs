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
  // The app's own `@/` alias (tsconfig.json paths). Without it a suite can only
  // import a lib file that has no `@/` import at runtime, which is why the
  // components had no behaviour tests at all: headline-card-controls.test.ts
  // presses the Overview card's controls through its real imports.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.(test|spec).ts?(x)'],
  roots: ['<rootDir>/src/lib'],
};
