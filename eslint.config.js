// @ts-check
/**
 * ESLint configuration — follows the official obsidianmd eslint-plugin README.
 * https://github.com/obsidianmd/eslint-plugin
 *
 * Aligned with obsidian-sync (same recommended bundle + gradual-adoption overrides).
 * Svelte UI is ignored here; use `npm run svelte-check` for Svelte.
 */
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
	// ── Ignore build output, Svelte UI, and tests ───────────────────────────
	{
		ignores: [
			"node_modules/**",
			"main.js",
			"styles.css",
			"**/*.test.ts",
			// Svelte panels: lint via svelte-check; official plugin targets .ts Obsidian APIs
			"**/*.svelte",
		],
	},

	// ── Official Obsidian recommended rules ─────────────────────────────────
	// Bundles: @eslint/js, typescript-eslint recommended-type-checked,
	// Obsidian-specific rules, Microsoft SDL, eslint-plugin-import …
	...obsidianmd.configs.recommended,

	// ── TypeScript parser + project-specific overrides ──────────────────────
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			// Node.js globals for Desktop (Electron) + shared code
			globals: {
				...globals.browser,
				...globals.node,
			},
		},

		rules: {
			// ── Downgrade unsafe-any to warn (gradual adoption) ─────────────────
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unsafe-member-access": "warn",
			"@typescript-eslint/no-unsafe-call": "warn",
			"@typescript-eslint/no-unsafe-assignment": "warn",
			"@typescript-eslint/no-unsafe-return": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
			"@typescript-eslint/no-floating-promises": "warn",
			// Unused variables — args:none avoids false positives on interface method param names
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

			// ── Rules that don't fit this codebase (turn off) ──────────────────
			// console.* used throughout for debug logging
			"no-console": "off",
			// async without await is used to satisfy interface contracts
			"@typescript-eslint/require-await": "off",
			// String(e) in catch blocks is intentional error formatting
			"@typescript-eslint/no-base-to-string": "off",
			// @ts-expect-error (with description) for untyped Obsidian / Foundry APIs
			"@typescript-eslint/ban-ts-comment": "warn",
			// TypeScript handles undefined references — no-undef is redundant for .ts
			"no-undef": "off",
			// Settings still use imperative Setting API (same as sync gradual plan)
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			"obsidianmd/settings-tab/prefer-update-over-display": "off",
			// Template literals with mixed types (notices, paths)
			"@typescript-eslint/restrict-template-expressions": "off",
			// void used to discard promises intentionally
			"no-void": "off",
			"@typescript-eslint/no-deprecated": "warn",
		},
	},

	// ── Settings tab: display() patterns ────────────────────────────────────
	{
		files: ["src/setting.ts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},


	// ── JSZip async shims: Node/globalThis polyfills, not Obsidian UI ─────────
	// Replaces setimmediate/immediate DOM script fallbacks for review; popout
	// timer / window rules do not apply to these platform polyfills.
	{
		files: ["src/shims/**"],
		rules: {
			"obsidianmd/prefer-window-timers": "off",
			"obsidianmd/no-global-this": "off",
		},
	},

	// ── Local preview: native fetch required for app:// assets ──────────────
	// Obsidian requestUrl cannot load app://obsidian.md/* (core CSS / fonts).
	// Faithful As-is packaging must use native fetch for those protocol URLs.
	{
		files: ["src/obsidian-local-preview/index.ts"],
		rules: {
			"no-restricted-globals": "off",
		},
	},
]);
