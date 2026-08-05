import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `any` opts out of the type system — the whole reason we use TypeScript.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // ignoreRestSiblings allows the `const { secret, ...rest } = x` omit idiom.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-undef': 'off', // TypeScript already covers this, and knows the DOM lib
      'no-empty': ['error', { allowEmptyCatch: true }], // deliberate best-effort swallows

      // Stylistic Svelte rules this codebase doesn't follow. Each is a large,
      // behavior-touching refactor, not a lint fix — left off rather than
      // silenced file-by-file.
      'svelte/require-each-key': 'off',
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, svelteConfig },
    },
  },
  {
    ignores: ['build/', '.svelte-kit/', 'node_modules/', 'static/'],
  },
);
