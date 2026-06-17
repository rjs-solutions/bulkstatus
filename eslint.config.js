import globals from "globals";

// Flat config (ESLint v9+). Run with: npm run lint
export default [
  {
    files: ["extension/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "warn",
      eqeqeq: ["warn", "smart"]
    }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node }
    }
  }
];
