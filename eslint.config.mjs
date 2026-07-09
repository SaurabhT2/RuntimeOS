// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "core-contracts", pattern: "packages/core-contracts/*" },
        { type: "provider-sdk", pattern: "packages/providers/provider-sdk/*" },
        { type: "provider-adapter", pattern: "packages/providers/{groq,nvidia-nim,_template}/*" },
        { type: "package", pattern: "packages/*" },
        { type: "app", pattern: "apps/*" },
      ],
    },
    rules: {
      // Automated enforcement of ADR-003 (architecture §28): provider adapters
      // may only import provider-sdk and core-contracts — never each other,
      // never a raw provider SDK re-exported elsewhere, never an app.
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "core-contracts", allow: [] },
            { from: "provider-sdk", allow: ["core-contracts"] },
            { from: "provider-adapter", allow: ["provider-sdk", "core-contracts"] },
            { from: "package", allow: ["package", "core-contracts", "provider-sdk"] },
            {
              from: "app",
              allow: ["package", "provider-adapter", "provider-sdk", "core-contracts"],
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  prettier,
);
