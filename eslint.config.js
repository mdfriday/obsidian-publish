// @ts-check
/**
 * ESLint configuration — follows the official obsidianmd eslint-plugin README.
 * https://github.com/obsidianmd/eslint-plugin
 *
 * Aligned with obsidian-sync; adapted for publish (Svelte UI ignored for now).
 */
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
	{
		ignores: [
			"node_modules/**",
			"main.js",
			"**/*.test.ts",
			"**/*.svelte",
			"src/markdown/**",
		],
	},

	...obsidianmd.configs.recommended,

	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			globals: {
				...globals.browser,
				...globals.node,
			},
		},

		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-unsafe-call": "warn",
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-floating-promises": "warn",
			"@typescript-eslint/no-unused-vars": ["warn", {
				args: "none",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			}],
			"no-unused-vars": ["warn", {
				args: "none",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			}],

			"no-console": "off",
			"@typescript-eslint/require-await": "off",
			"@typescript-eslint/no-base-to-string": "off",
			"@typescript-eslint/ban-ts-comment": "warn",
			"no-undef": "off",
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			"@typescript-eslint/restrict-template-expressions": "off",
			"no-void": "off",
			"obsidianmd/settings-tab/prefer-update-over-display": "off",
			"@typescript-eslint/no-deprecated": "warn",
			"@typescript-eslint/no-misused-promises": "warn",
			"@typescript-eslint/no-redundant-type-constituents": "off",
			"@typescript-eslint/no-unnecessary-type-assertion": "warn",
			// Gradual adoption (legacy friday-plugin patterns)
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/no-empty-object-type": "warn",
			"obsidianmd/detach-leaves": "warn",
			"obsidianmd/settings-tab/no-manual-html-headings": "warn",
			"obsidianmd/prefer-create-el": "warn",
			"obsidianmd/prefer-window-timers": "warn",
			"obsidianmd/no-static-styles-assignment": "warn",
		},
	},

	{
		files: ["src/setting.ts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
]);
