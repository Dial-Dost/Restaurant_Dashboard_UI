import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nodePlugin from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import reactHooks from 'eslint-plugin-react-hooks';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

const config = [
  {
    // Flat config matches these as PATHS, not prefixes: a bare 'node_modules'
    // matches a file of that name, never its contents. Without the /** the
    // linter walked every dependency and reported ~950k problems, which is why
    // `npm run lint` has never actually run here despite CI gating on it.
    ignores: [
      'node_modules/**',
      '.next/**',
      '.claude/**', // agent worktrees: full copies of this app, not source
      'build/**',
      'out/**',
      'coverage/**',
      'public/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  nodePlugin.configs['flat/recommended'],
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // --- Type-safety, beyond the strictTypeChecked preset ---
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // strictTypeChecked bans numbers in template literals; a currency
      // dashboard interpolates ₹ amounts everywhere and Number#toString is
      // deterministic, so keep the rule's own non-strict default instead.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `name || "fallback"` on strings is deliberate here: an empty string
      // must fall through to the fallback, which `??` would not do.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],

      // --- Prefer the TS-aware version of these core rules ---
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-use-before-define': 'off',
      // Function declarations hoist; the house file layout is component
      // first, helpers below it.
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],

      // tsc owns module resolution; plugin-n cannot read tsconfig `paths`,
      // so it flags every '@/…' alias import as missing.
      'n/no-missing-import': 'off',

      // Almost every file here is universal Next.js code; plugin-n reads
      // `navigator`, `CustomEvent`, `fetch` … as Node builtins and gates them
      // on the engines range, but they are browser globals in client
      // components and Next guarantees fetch/Response on the server.
      'n/no-unsupported-features/node-builtins': 'off',

      // React hooks correctness (the plugin Next's own config would bring).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // eslint-plugin-security's object-injection check is notoriously
      // noisy on typed code (every obj[key] access flags, even when the
      // type system already constrains `key`); the rest of the recommended
      // set stays on.
      'security/detect-object-injection': 'off',

      // --- General strictness ---
      // `x == null` is the codebase's deliberate null-or-undefined check.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    // Plain JS/CJS tooling scripts live outside the tsconfig project;
    // keep basic linting but drop type-aware rules that need a TS program.
    files: ['**/*.js', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Tests: `expect(x).not.toBeNull()` then `x!` is the house assertion
    // style, and fixture paths/regexes are not attacker input.
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
];

export default config;
