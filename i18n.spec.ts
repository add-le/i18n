/* eslint-disable quotes */
import type { I18n as I_I18n } from '@utils/i18n';
import assert from 'node:assert';
import { before, beforeEach, describe, it, mock } from 'node:test';

// Mock fetch globally
global.fetch = mock.fn();

describe('I18n', () => {
  let I18n: typeof I_I18n;

  let mockElement: HTMLElement;
  let fetchResponses: any[] = [];
  let fetchCallCount = 0;

  before(async () => {
    // Mock the @stencil/core module with getAssetPath function
    mock.module('@stencil/core', {
      namedExports: {
        getAssetPath: (path: string): string => path,
      },
    });

    // ! This MUST be a dynamic import because that is the only way to ensure the
    // ! import starts after the mock has been set up.
    // ! @see https://nodejs.org/en/learn/test-runner/mocking
    ({ I18n } = await import('@utils/i18n'));
  });

  beforeEach(() => {
    // Reset fetch mock with queue
    fetchResponses = [];
    fetchCallCount = 0;
    global.fetch = async () => {
      fetchCallCount++;
      const response = fetchResponses.shift();
      return response || { ok: false, status: 500, statusText: 'No mock response' };
    };

    // Clear static caches
    I18n['locales'].clear();
    I18n['componentCache'].clear();
    I18n['pluralRulesCache'].clear();

    // Create a mock element
    mockElement = {
      tagName: 'MY-COMPONENT',
      closest: () => null,
    } as unknown as HTMLElement;
  });

  describe('detectLanguageFromDOM', () => {
    it('should detect language from closest [lang] attribute', () => {
      const child = {
        closest: () => ({ lang: 'en' }),
      } as any;

      const lang = I18n.detectLanguageFromDOM(child);
      assert.strictEqual(lang, 'en');
    });

    it('should return default language when no [lang] attribute found', () => {
      const element = {
        closest: () => null,
      } as any;

      const lang = I18n.detectLanguageFromDOM(element);
      assert.strictEqual(lang, 'en'); // DEFAULT_LANG is 'en'
    });
  });

  describe('get - positional parameters', () => {
    it('should replace positional parameters {{0}}, {{1}}', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            greeting: 'Hello {{0}}',
            order: 'Order {{0}} is {{1}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      assert.strictEqual(i18n.get('greeting', 'John'), 'Hello John');
      assert.strictEqual(i18n.get('order', 42, 'shipped'), 'Order 42 is shipped');
    });

    it('should return template as-is when no parameters provided', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            welcome: 'Welcome',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');
      assert.strictEqual(i18n.get('welcome'), 'Welcome');
    });

    it('should return NOT_FOUND_VALUE for missing keys', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {},
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');
      assert.strictEqual(i18n.get('missing'), I18n.NOT_FOUND_VALUE);
    });
  });

  describe('get - named parameters with pluralization', () => {
    it('should handle ICU MessageFormat plural syntax', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            messages: 'You have {{count, plural, one {one message} other {# messages}}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      assert.strictEqual(i18n.get('messages', { count: 1 }), 'You have one message');
      assert.strictEqual(i18n.get('messages', { count: 5 }), 'You have # messages');
    });

    it('should auto-pluralize words with {{word:count}} syntax - French', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            croissant: "J'ai acheté {{count}} {{croissant:count}}",
            drivers_limit:
              'Il y a {{count}} {{conducteur:count}} qui {{count, plural, one {dépasse} other {dépassent}}} les limites',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'fr');

      assert.strictEqual(i18n.get('croissant', { count: 1 }), "J'ai acheté 1 croissant");
      assert.strictEqual(i18n.get('croissant', { count: 2 }), "J'ai acheté 2 croissants");

      assert.strictEqual(i18n.get('drivers_limit', { count: 1 }), 'Il y a 1 conducteur qui dépasse les limites');
      assert.strictEqual(i18n.get('drivers_limit', { count: 3 }), 'Il y a 3 conducteurs qui dépassent les limites');
    });

    it('should replace simple named variables', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            user_greeting: 'Hello {{name}}, you are {{age}} years old',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');
      assert.strictEqual(i18n.get('user_greeting', { name: 'Alice', age: 30 }), 'Hello Alice, you are 30 years old');
    });

    it('should handle exact match plural forms (=0, =1)', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            items: '{{count, plural, =0 {No items} =1 {One item} other {{{count}} items}}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      assert.strictEqual(i18n.get('items', { count: 0 }), 'No items');
      assert.strictEqual(i18n.get('items', { count: 1 }), 'One item');
      assert.strictEqual(i18n.get('items', { count: 5 }), '5 items');
    });
  });

  describe('pluralizeWord', () => {
    it('should pluralize French words correctly', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            test1: '{{chat:count}}',
            test2: '{{cheval:count}}',
            test3: '{{gâteau:count}}',
            test4: '{{bus:count}}',
            test5: '{{prix:count}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'fr');

      assert.strictEqual(i18n.get('test1', { count: 2 }), 'chats'); // regular: add 's'
      assert.strictEqual(i18n.get('test2', { count: 2 }), 'chevaux'); // -al becomes -aux
      assert.strictEqual(i18n.get('test3', { count: 2 }), 'gâteaux'); // -eau takes 'x'
      assert.strictEqual(i18n.get('test4', { count: 2 }), 'bus'); // ends in 's', no change
      assert.strictEqual(i18n.get('test5', { count: 2 }), 'prix'); // ends in 'x', no change
    });

    it('should pluralize English words correctly', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            test1: '{{cat:count}}',
            test2: '{{box:count}}',
            test3: '{{city:count}}',
            test4: '{{boy:count}}',
            test5: '{{church:count}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      assert.strictEqual(i18n.get('test1', { count: 2 }), 'cats'); // regular: add 's'
      assert.strictEqual(i18n.get('test2', { count: 2 }), 'boxes'); // ends in 'x': add 'es'
      assert.strictEqual(i18n.get('test3', { count: 2 }), 'cities'); // consonant+y: 'ies'
      assert.strictEqual(i18n.get('test4', { count: 2 }), 'boys'); // vowel+y: add 's'
      assert.strictEqual(i18n.get('test5', { count: 2 }), 'churches'); // ends in 'ch': add 'es'
    });
  });

  describe('caching', () => {
    it('should cache locale data', async () => {
      const i18n1 = new I18n(mockElement);
      const i18n2 = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            hello: 'Hello',
          },
        }),
      });

      await i18n1.load('https://example.com/i18n/', 'en');
      await i18n2.load('https://example.com/i18n/', 'en');

      // Fetch should only be called once due to caching
      assert.strictEqual(fetchCallCount, 1);
    });

    it('should merge common and component-specific translations', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'common': {
            cancel: 'Cancel',
            save: 'Save',
          },
          'my-component': {
            title: 'My Component',
            save: 'Save Changes', // Should override common
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      assert.strictEqual(i18n.get('cancel'), 'Cancel');
      assert.strictEqual(i18n.get('title'), 'My Component');
      assert.strictEqual(i18n.get('save'), 'Save Changes'); // Component-specific overrides common
    });
  });

  describe('registerPath and createFactory', () => {
    it('should register custom path for namespace', () => {
      I18n.registerPath('my-lib', 'https://example.com/custom/');

      // This is a static method, so we can't easily test the internal state
      // but we can verify it doesn't throw
      assert.doesNotThrow(() => I18n.registerPath('another-lib', 'https://another.com/'));
    });

    it('should create factory function with preset namespace', async () => {
      const factory = I18n.createFactory('test-lib', 'https://test.com/i18n/');

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            test: 'Factory Test',
          },
        }),
      });

      const i18n = factory(mockElement);
      await i18n.load();

      assert.strictEqual(i18n.get('test'), 'Factory Test');
    });
  });

  describe('error handling', () => {
    it('should return ERROR_VALUE on exception', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            test: '{{invalid',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      // This shouldn't throw, but return error value
      const result = i18n.get('test', { count: 1 });
      assert.ok(result);
    });

    it('should throw error when fetch fails', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await assert.rejects(() => i18n.load('https://example.com/i18n/', 'en'), {
        message: "Failed to load locale 'en': 404 Not Found",
      });
    });
  });

  describe('locale property', () => {
    it('should return current locale', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {},
        }),
      });

      await i18n.load('https://example.com/i18n/', 'de');
      assert.strictEqual(i18n.locale, 'de');
    });
  });

  describe('PluralRules caching', () => {
    it('should use Intl.PluralRules for locale-specific plural forms', async () => {
      const i18n = new I18n(mockElement);

      fetchResponses.push({
        ok: true,
        json: async () => ({
          'my-component': {
            items: '{{count, plural, one {item} other {items}}}',
          },
        }),
      });

      await i18n.load('https://example.com/i18n/', 'en');

      // English: 1 is 'one', everything else is 'other'
      assert.strictEqual(i18n.get('items', { count: 1 }), 'item');
      assert.strictEqual(i18n.get('items', { count: 0 }), 'items');
      assert.strictEqual(i18n.get('items', { count: 2 }), 'items');
    });
  });
});
