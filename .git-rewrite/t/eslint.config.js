import tseslint from "typescript-eslint";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
    ],
  },

  // Base recommended rules for all TypeScript files
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      // Allow explicit `any` — some SDK types require it
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow unused vars prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Allow empty catch blocks (used for graceful fallbacks)
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Allow non-null assertions — used sparingly in typed code
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Test files — relaxed rules
  {
    files: ["packages/*/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
