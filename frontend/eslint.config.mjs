/*
 * One rule, wired into the build: no-undef.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * An identifier that resolves to nothing is not a style problem in a React
 * app — it is a blank white page. React unmounts the whole tree when a render
 * throws, so a single out-of-scope name takes down the entire screen and the
 * user is given no message, no error, and nothing to report beyond "it went
 * blank".
 *
 * It has happened twice. `takenRoles` was read inside UserFormModal while being
 * declared in AdminPage — sibling function scopes, so the admin page blanked
 * the moment anybody pressed "Add user". And `setAnonymous` survived in
 * SubmitPage's resetForm after the state behind it was removed, throwing on
 * every successful submission; because it threw inside the submit handler's
 * try, authors were shown "server error" for ideas that had actually saved.
 *
 * Both compiled cleanly and both passed the existing build. Nothing but scope
 * analysis finds them, which is what this is here to do.
 *
 * ── Deliberately just the one rule ─────────────────────────────────────────
 *
 * Not a style config. Turning on a recommended set would light up a codebase of
 * this size with hundreds of opinions that have nothing to do with correctness,
 * and a check that shouts is a check people learn to skip. This one only fires
 * on code that cannot work.
 */
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
       * a check earns being ignored — and the directives are not wrong, they
       * are simply for a config that is not this one.
       */
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // JSX is compiled by Vite's automatic runtime, so `React` is not
      // referenced and no-undef never sees it. Nothing to declare here.
      'no-undef': 'error',
    },
  },
];
