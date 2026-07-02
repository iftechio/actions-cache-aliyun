import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "packages/cache/lib/**",
            "**/*.js",
            "**/*.mjs"
        ]
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
    prettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest
            }
        },
        plugins: {
            "simple-import-sort": simpleImportSort
        },
        rules: {
            "import/first": "error",
            "import/newline-after-import": "error",
            "import/no-duplicates": "error",
            "simple-import-sort/imports": "error",
            "sort-imports": "off"
        }
    }
);
