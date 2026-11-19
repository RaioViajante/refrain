import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The archived application has its own configuration and is read-only.
    "archive/**",
    // Local-only design references and review captures (ignored by Git).
    "reference/**",
    "visual-review/**",
    "local/**",
  ]),
  {
    rules: {
      // The archive is never a dependency of the new application.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)archive(/|$)",
              message:
                "The archived music diary is read-only and never imported by the new application.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
