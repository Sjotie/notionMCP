import { jest } from '@jest/globals';
import { getNotionApiKeyForUserToken, getFirefliesApiTokenForUserToken } from '../../utils/api-keys.js';

describe('API Key Retrieval Functions', () => {
  let originalEnv;
  let consoleLogSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('getNotionApiKeyForUserToken', () => {
    test('should return specific Notion API key for user token', () => {
      process.env.SJOERD_TOKEN_NOTION_API_KEY = 'secret_sjoerd_123';
      
      const apiKey = getNotionApiKeyForUserToken('sjoerd_token');
      
      expect(apiKey).toBe('secret_sjoerd_123');
      expect(consoleLogSpy).toHaveBeenCalledWith('[sjoerd_token] Found Notion API key in env var: SJOERD_TOKEN_NOTION_API_KEY');
    });

    test('should return default Notion API key when no specific key found', () => {
      process.env.DEFAULT_NOTION_API_KEY = 'secret_default_456';
      
      const apiKey = getNotionApiKeyForUserToken('unknown_token');
      
      expect(apiKey).toBe('secret_default_456');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[unknown_token] No specific Notion API key found in env for token. Falling back to default if available.');
    });

    test('should return undefined when no API key found', () => {
      delete process.env.DEFAULT_NOTION_API_KEY;
      
      const apiKey = getNotionApiKeyForUserToken('unknown_token');
      
      expect(apiKey).toBeUndefined();
    });

    test('should handle uppercase conversion correctly', () => {
      process.env.MIXED_CASE_TOKEN_NOTION_API_KEY = 'secret_mixed_789';
      
      const apiKey = getNotionApiKeyForUserToken('MiXeD_CaSe_ToKeN');
      
      expect(apiKey).toBe('secret_mixed_789');
    });

    test('should return null for null user token', () => {
      const apiKey = getNotionApiKeyForUserToken(null);
      
      expect(apiKey).toBeNull();
    });
  });

  describe('getFirefliesApiTokenForUserToken', () => {
    test('should return specific Fireflies API token for user token', () => {
      process.env.SJOERD_TOKEN_FIREFLIES_API_TOKEN = 'ff_token_sjoerd_123';
      
      const apiToken = getFirefliesApiTokenForUserToken('sjoerd_token');
      
      expect(apiToken).toBe('ff_token_sjoerd_123');
      expect(consoleLogSpy).toHaveBeenCalledWith('[sjoerd_token] Found Fireflies API token in env var: SJOERD_TOKEN_FIREFLIES_API_TOKEN');
    });

    test('should return default Fireflies API token when no specific token found', () => {
      process.env.DEFAULT_FIREFLIES_API_TOKEN = 'ff_token_default_456';
      
      const apiToken = getFirefliesApiTokenForUserToken('unknown_token');
      
      expect(apiToken).toBe('ff_token_default_456');
      expect(consoleWarnSpy).toHaveBeenCalledWith('[unknown_token] No Fireflies API token for token; using default if set.');
    });

    test('should return null when no API token found', () => {
      delete process.env.DEFAULT_FIREFLIES_API_TOKEN;
      
      const apiToken = getFirefliesApiTokenForUserToken('unknown_token');
      
      expect(apiToken).toBeNull();
    });

    test('should handle null user token', () => {
      const apiToken = getFirefliesApiTokenForUserToken(null);
      
      expect(apiToken).toBeNull();
    });
  });
});