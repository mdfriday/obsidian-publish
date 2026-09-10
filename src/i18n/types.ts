/**
 * Supported language codes
 */
export type LanguageCode =
	| "en"
	| "zh-cn"
	| "es"
	| "fr"
	| "de"
	| "ja"
	| "ko"
	| "pt";

/**
 * Language information for display
 */
export interface LanguageInfo {
	code: LanguageCode;
	name: string;
	nativeName: string;
}

/**
 * Translation namespaces used by the publish sidebar / menus.
 * Leaf values are template strings (may include {{vars}}).
 */
export type TranslationNamespace = {
	ui?: Record<string, string>;
	menu?: Record<string, string>;
	messages?: Record<string, string>;
	settings?: Record<string, string>;
	theme?: Record<string, string>;
	projects?: Record<string, string>;
	common?: Record<string, string>;
	info?: Record<string, string>;
	chat?: Record<string, string>;
	commands?: Record<string, string>;
};

/**
 * Translation function type
 */
export type TranslationFunction = (
	key: string,
	params?: Record<string, string | number | unknown>,
) => string;

/**
 * I18n service interface
 */
export interface II18nService {
	t: TranslationFunction;
	getCurrentLanguage(): LanguageCode;
	setLanguage(code: LanguageCode): Promise<void>;
	getAvailableLanguages(): LanguageInfo[];
	isReady(): boolean;
}
