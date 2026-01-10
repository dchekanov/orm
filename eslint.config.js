import globals from 'globals';
import pluginJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  pluginJs.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': [
        'error',
        {
          allow: ['warn', 'error', 'info'],
        },
      ],
      curly: 'error',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.mocha },
    },
  },
];
