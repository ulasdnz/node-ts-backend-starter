import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import mongooseSafety from './eslint/plugin-mongoose-safety.js';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.husky/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: [
      'src/modules/user/**/*.{ts,js}',
      // if you want to use soft delete plugin in other modules, add them here
      // Example: 'src/modules/{module_name}/**/*.{ts,js}'
    ],
    plugins: {
      'mongoose-safety': mongooseSafety,
    },
    rules: {
      'mongoose-safety/aggregate-policy': 'error',
      'mongoose-safety/no-hard-delete': 'error',
    },
  },
);
