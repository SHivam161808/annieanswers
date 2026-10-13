import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'build/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['tools/**', 'load/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['load/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', performance: 'readonly' },
    },
  },
);
