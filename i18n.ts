import { getAssetPath } from '@stencil/core';

interface LocaleData {
  common?: Record<string, string>;
  [componentName: string]: Record<string, string> | undefined;
}

export type I18nFactory = (element: HTMLElement) => I18n;
export type MappedParams = Record<string, string | number>;

export class I18n {
  public static readonly NOT_FOUND_VALUE = '?..?';
  public static readonly ERROR_VALUE = '?**?';

  private static readonly DEFAULT_LANG = 'en';
  private static readonly DEFAULT_PATH = `${getAssetPath('../build/')}json`;
  private static readonly locales = new Map<string, LocaleData>();
  private static readonly componentCache = new Map<string, Record<string, string>>();
  private static readonly registeredPaths = new Map<string, string>();
  private static readonly pluralRulesCache = new Map<string, Intl.PluralRules>();

  // Pre-compiled regex patterns for performance
  private static readonly POSITIONAL_PARAM_REGEX = /\{\{(\d+)\}\}/g;
  private static readonly AUTO_PLURAL_REGEX = /\{\{([^:}]+):(\w+)\}\}/gu;
  private static readonly SIMPLE_VAR_REGEX = /\{\{(\w+)\}\}/g;

  private strings: Record<string, string> = {};
  private _locale: string = '';

  /**
   * Current loaded locale by i18n.
   * @returns {Readonly<string>} The current locale code (e.g., 'en', 'fr').
   */
  public get locale(): Readonly<string> {
    return this._locale;
  }

  /**
   * Registers a custom path for loading locale files for a specific namespace.
   * @param {string} namespace The namespace identifier for your library (e.g., 'my-lib', 'my-app').
   * @param {string} path The base URL where locale JSON files are located.
   *
   * @example
   * ```typescript
   * // In your app initialization
   * I18n.registerPath('my-lib', 'https://example.com/i18n/');
   *
   * // Then in components
   * const i18n = new I18n(element, 'my-lib');
   * ```
   */
  public static registerPath(namespace: string, path: string): void {
    I18n.registeredPaths.set(namespace, path);
  }

  /**
   * Creates a factory function that produces I18n instances with a preset namespace.
   * @param {string} namespace The namespace identifier for your library.
   * @param {string} path The base URL where locale JSON files are located.
   * @returns {I18nFactory} A factory function that creates I18n instances with the preset namespace.
   *
   * @example
   * ```typescript
   * // In your library's initialization file
   * export const createI18n = I18n.createFactory('my-lib', 'https://example.com/i18n/');
   *
   * // Then in any component
   * const i18n = createI18n(element);
   * await i18n.load();
   *
   * You can create a helper to simplify usage:
   *
   * import { I18n } from '@utils/i18n';
   * export type { I18n } from '@utils/i18n';
   * // I18n factory function for s3p-components-utils library.
   * export const I18nFactory = I18n.createFactory('s3p-components-utils', 'https://app.mapandtruck.io/libs/assets/s3p-components-utils/i18n/');
   * ```
   */
  public static createFactory(namespace: string, path: string): I18nFactory {
    I18n.registerPath(namespace, path);
    return (element: HTMLElement) => new I18n(element, namespace);
  }

  /**
   * Creates an instance of I18n for the specified HTML element.
   * @param {HTMLElement} element The HTML element associated with this I18n instance.
   * @param {string} [namespace] Optional namespace to use a specific registered path.
   *
   * @example
   * ```typescript
   * const i18n = new I18n(element, 'my-lib');
   * ```
   */
  public constructor(
    private readonly element: HTMLElement,
    private readonly namespace?: string,
  ) {}

  /**
   * Fetches and merges locale strings for a specific component.
   * @param {string} url Base URL where locale JSON files are located.
   * @param {string} componentName The name of the component (e.g., 'my-component').
   * @param {string} locale The locale code to fetch (e.g., 'en', 'fr').
   * @returns {Promise<Record<string, string>>} A promise that resolves to the merged locale strings.
   * @throws {Error} When the locale file cannot be fetched or parsed.
   *
   * @example
   * ```typescript
   * const strings = await i18n.fetchLocaleStrings('https://example.com/i18n/', 'my-component', 'en');
   * ```
   */
  private async fetchLocaleStrings(
    url: string,
    componentName: string,
    locale: string,
  ): Promise<Record<string, string>> {
    const cacheKey = `${locale}:${componentName}`;

    // Return cached merged result if available
    const cached = I18n.componentCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch locale data if not already loaded
    if (!I18n.locales.has(locale)) {
      const response = await fetch(`${url}${url.endsWith('/') ? '' : '/'}${locale}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load locale '${locale}': ${response.status} ${response.statusText}`);
      }

      I18n.locales.set(locale, await response.json());
    }

    // Merge and cache the result
    const localeData = I18n.locales.get(locale)!;
    const common = localeData.common || {};
    const component = localeData[componentName] || {};
    const merged = { ...common, ...component };

    I18n.componentCache.set(cacheKey, merged);
    return merged;
  }

  /**
   * Detects the language for a component by traversing up the DOM tree. \
   * Searches for the nearest parent element with a `lang` attribute.
   * @param {HTMLElement} element The HTML element to start searching from.
   * @returns {string} The detected language code (e.g., 'en', 'fr') or the default language if none found.
   *
   * @example
   * ```typescript
   * const lang = I18n.detectLanguageFromDOM(element);
   * // Returns 'en' if no [lang] attribute found in ancestors
   * ```
   */
  public static detectLanguageFromDOM(element: HTMLElement): string {
    const closestElement = element.closest('[lang]') as HTMLElement;
    return closestElement ? closestElement.lang : I18n.DEFAULT_LANG;
  }

  /**
   * Loads translation strings for the component from the specified URL.
   * @param {string} [url] Base URL where locale JSON files are located (e.g., 'https://example.com/i18n/'). \
   * *Defaults to the namespace path set via registerPath() or the build assets path.*
   * @param {string} [locale] Optional locale code to load. If not provided, detects from DOM hierarchy.
   * @throws {Error} When the locale file cannot be fetched or parsed.
   *
   * @example
   * ```typescript
   * await i18n.load('https://app.mapandtruck.io/libs/assets/s3p-components-utils/i18n/', 'en');
   * ```
   */
  public async load(url?: string, locale?: string): Promise<void> {
    const effectivePath = url || (this.namespace && I18n.registeredPaths.get(this.namespace)) || I18n.DEFAULT_PATH;
    this._locale = locale || I18n.detectLanguageFromDOM(this.element);
    this.strings = await this.fetchLocaleStrings(effectivePath, this.element.tagName.toLowerCase(), this._locale);
  }

  /**
   * Retrieves a translated string by key and optionally interpolates parameters.
   * @param {string} key The translation key to look up.
   * @param {(string | number | MappedParams)[]} params Parameters for interpolation. \
   * Can be positional (for `{{0}}`, `{{1}}`) or a single object with named parameters (for `{{count}}`, `{{name}}`, etc.).
   * @returns {string} The translated string with parameters interpolated, `"?..?"` if key not found, or `"?**?"` if error occurs.
   *
   * @example
   * ```typescript
   * // Positional parameters
   * i18n.get('greeting', 'John');           // "Hello {{0}}" -> "Hello John"
   * i18n.get('order', 42, 'shipped');       // "Order {{0}} is {{1}}" -> "Order 42 is shipped"
   *
   * // Named parameters with auto-pluralization
   * i18n.get('drivers_limit', { count: 1 });
   * // JSON: "Il y a {{count}} {{conducteur:count}} qui {{count, plural, one {dépasse} other {dépassent}}} les limites"
   * // -> "Il y a 1 conducteur qui dépasse les limites"
   *
   * i18n.get('drivers_limit', { count: 3 });
   * // -> "Il y a 3 conducteurs qui dépassent les limites"
   *
   * i18n.get('croissant', { count: 2 });
   * // JSON: "J'ai acheté {{count}} {{croissant:count}}"
   * // -> "J'ai acheté 2 croissants"
   * ```
   */
  public get(key: string, ...params: (string | number | MappedParams)[]): string {
    try {
      const template = this.strings[key];
      if (typeof template !== 'string') {
        return I18n.NOT_FOUND_VALUE;
      }

      // Fast path: no parameters
      if (params.length === 0) {
        return template;
      }

      // Check if using named parameters (object)
      const isNamedParams = params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0]);

      if (isNamedParams) {
        return this.interpolateNamed(template, params[0] as MappedParams);
      }

      // Positional parameters (legacy support)
      return template.replace(I18n.POSITIONAL_PARAM_REGEX, (_, index) => {
        const param = params[+index]; // Unary + is faster than parseInt for simple digits
        return param != null ? String(param) : '';
      });
    } catch {
      return I18n.ERROR_VALUE;
    }
  }

  /**
   * Interpolates named parameters and handles pluralization.
   * @param {string} template The template string with named placeholders.
   * @param {MappedParams} params An object mapping parameter names to their values.
   * @returns {string} The interpolated string.
   */
  private interpolateNamed(template: string, params: MappedParams): string {
    // First pass: handle plural forms with explicit one/other syntax
    // We need to manually parse to handle nested braces correctly
    let result = template;
    const pluralMatches: Array<{ start: number; end: number; replacement: string }> = [];

    let i = 0;
    while (i < result.length) {
      // Look for {{varName, plural,
      if (result.substring(i, i + 2) === '{{') {
        const varMatch = /^(\w+),\s*plural,\s*/.exec(result.substring(i + 2));
        if (varMatch) {
          const varName = varMatch[1];
          const value = params[varName];

          if (typeof value === 'number') {
            // Find the matching }}
            let j = i + 2 + varMatch[0].length;
            let depth = 2; // We start with 2 because {{
            const formsStart = j;

            while (j < result.length && depth > 0) {
              if (result[j] === '{') {
                depth++;
                j++;
              } else if (result[j] === '}') {
                depth--;
                j++;
              } else {
                j++;
              }
            }

            if (depth === 0) {
              const formsStr = result.substring(formsStart, j - 2); // j-2 to exclude the final }}
              const replacement = this.parsePluralForms(formsStr, value);
              pluralMatches.push({ start: i, end: j, replacement });
              i = j;
              continue;
            }
          }
        }
      }
      i++;
    }

    // Apply replacements in reverse order
    for (let idx = pluralMatches.length - 1; idx >= 0; idx--) {
      const { start, end, replacement } = pluralMatches[idx];
      result = result.substring(0, start) + replacement + result.substring(end);
    }

    // Second pass: auto-pluralize words based on count references
    // Syntax: {{word:count}} will pluralize 'word' based on the value of 'count'
    result = result.replace(I18n.AUTO_PLURAL_REGEX, (_, word, countVar) => {
      const count = params[countVar];
      if (typeof count !== 'number') {
        return word;
      }

      const pluralForm = this.getPluralForm(count);
      return pluralForm === 'one' ? word : this.pluralizeWord(word);
    });

    // Third pass: replace simple named variables
    result = result.replace(I18n.SIMPLE_VAR_REGEX, (match, varName) => {
      const value = params[varName];
      return value != null ? String(value) : match;
    });

    return result;
  }

  private parsePluralForms(formsStr: string, value: number): string {
    // Parse all forms from the forms string, handling nested braces
    const forms: Record<string, string> = {};
    const exactMatches: Record<number, string> = {};

    let i = 0;
    while (i < formsStr.length) {
      // Skip whitespace
      while (i < formsStr.length && /\s/.test(formsStr[i])) i++;
      if (i >= formsStr.length) break;

      // Parse form key (=N or name)
      let exactNum: number | null = null;
      let formName = '';

      if (formsStr[i] === '=') {
        i++;
        let numStr = '';
        while (i < formsStr.length && /\d/.test(formsStr[i])) {
          numStr += formsStr[i++];
        }
        exactNum = +numStr;
      } else {
        while (i < formsStr.length && /\w/.test(formsStr[i])) {
          formName += formsStr[i++];
        }
      }

      // Skip whitespace before '{'
      while (i < formsStr.length && /\s/.test(formsStr[i])) i++;
      if (i >= formsStr.length || formsStr[i] !== '{') break;

      // Extract content between braces, handling nesting
      i++; // skip '{'
      let depth = 1;
      let content = '';
      while (i < formsStr.length && depth > 0) {
        if (formsStr[i] === '{') depth++;
        else if (formsStr[i] === '}') depth--;

        if (depth > 0) content += formsStr[i];
        i++;
      }

      // Store the form
      if (exactNum !== null) {
        exactMatches[exactNum] = content;
      } else if (formName) {
        forms[formName] = content;
      }
    }

    // Check for exact match first (e.g., =0, =1)
    if (value in exactMatches) {
      return exactMatches[value];
    }

    // Get plural rule for the locale
    const pluralForm = this.getPluralForm(value);

    // Select the appropriate form based on plural rule
    return forms[pluralForm] ?? forms.other ?? '';
  }

  /**
   * Simple pluralization for French words (adds 's' or 'x' based on common rules).
   * @param {string} word The word to pluralize.
   * @returns {string} The pluralized form of the word.
   */
  private pluralizeWord(word: string): string {
    // French pluralization rules
    if (this._locale === 'fr') {
      // Words ending in 's', 'x', 'z' don't change
      if (/[sxz]$/i.test(word)) {
        return word;
      }
      // Words ending in 'au', 'eau', 'eu' take 'x'
      if (/(?:au|eau|eu)$/i.test(word)) {
        return word + 'x';
      }
      // Words ending in 'al' become 'aux'
      if (/al$/i.test(word)) {
        return word.slice(0, -2) + 'aux';
      }
      // Default: add 's'
      return word + 's';
    }

    // English pluralization (simple version)
    if (this._locale === 'en') {
      if (/(?:s|sh|ch|x|z)$/i.test(word)) {
        return word + 'es';
      }
      if (/[^aeiou]y$/i.test(word)) {
        return word.slice(0, -1) + 'ies';
      }
      return word + 's';
    }

    // Default: just add 's'
    return word + 's';
  }

  /**
   * Gets the plural form for a given number based on the current locale.
   * @param {number} count The number to determine the plural form for.
   * @returns {Intl.LDMLPluralRule} The plural form ('zero', 'one', 'two', 'few', 'many', 'other').
   */
  private getPluralForm(count: number): Intl.LDMLPluralRule {
    // Get or create PluralRules for current locale
    if (!I18n.pluralRulesCache.has(this._locale)) {
      I18n.pluralRulesCache.set(this._locale, new Intl.PluralRules(this._locale));
    }

    const rules = I18n.pluralRulesCache.get(this._locale)!;
    return rules.select(count);
  }
}
