// One rule, wired into the build: no-undef.
import globals from 'globals';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: {
      /*
       * The codebase carries eslint-disable comments for rules this config
       * does not enable, and each one reports as an "unused directive". Nine
       * warnings about comments, next to the errors that blank a page, is how
       * a check earns being ignored - and the directives are not wrong, they
       * are simply for a config that is not this one.
       */
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // JSX is compiled by Vite's automatic runtime, so `React` is not referenced and no-undef
      // never sees it. Nothing to declare here.
      'no-undef': 'error',
    },
  },
];
