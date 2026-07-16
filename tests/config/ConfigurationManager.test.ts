/**
 * Configuration Manager Tests
 * Aligned with the current AORP configuration model (env loading stubbed;
 * feature flags removed; profiles provide logging defaults).
 */

import { ConfigurationManager, Environment, ConfigurationError } from '../../src/config';

describe('ConfigurationManager', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };

    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    delete process.env.LOG_LEVEL;
    delete process.env.DEBUG;
    delete process.env.VIKUNJA_URL;
    delete process.env.VIKUNJA_API_TOKEN;
    delete process.env.RATE_LIMIT_ENABLED;

    ConfigurationManager.reset();
  });

  afterEach(() => {
    process.env = originalEnv;
    ConfigurationManager.reset();
  });

  describe('Environment Detection', () => {
    it('should detect test environment from JEST_WORKER_ID', async () => {
      process.env.JEST_WORKER_ID = '1';

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.TEST);
    });

    it('should detect test environment from NODE_ENV', async () => {
      process.env.NODE_ENV = 'test';

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.TEST);
    });

    it('should detect production environment from NODE_ENV', async () => {
      process.env.NODE_ENV = 'production';

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.PRODUCTION);
    });

    it('should default to development environment', async () => {
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.DEVELOPMENT);
    });

    it('should allow environment override via options', async () => {
      const manager = ConfigurationManager.getInstance({
        environment: Environment.PRODUCTION,
      });

      const config = await manager.getConfiguration();
      expect(config.environment).toBe(Environment.PRODUCTION);
    });
  });

  describe('Environment Profiles', () => {
    it('should apply development environment profile', async () => {
      process.env.NODE_ENV = 'development';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.logging.level).toBe('debug');
      expect(config.logging.environment).toBe(Environment.DEVELOPMENT);
      expect(config.rateLimiting.default.requestsPerMinute).toBe(60);
    });

    it('should apply test environment profile', async () => {
      process.env.NODE_ENV = 'test';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.logging.level).toBe('error');
      expect(config.logging.environment).toBe(Environment.TEST);
    });

    it('should apply production environment profile', async () => {
      process.env.NODE_ENV = 'production';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.logging.level).toBe('info');
      expect(config.logging.environment).toBe(Environment.PRODUCTION);
    });

    it('should cache configuration and return same instance on subsequent calls', async () => {
      process.env.NODE_ENV = 'development';

      const manager = ConfigurationManager.getInstance();
      const config1 = await manager.getConfiguration();
      const config2 = await manager.getConfiguration();

      expect(config1).toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('Configuration Override Priority', () => {
    it('should allow additional sources to override profile defaults', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          logging: {
            level: 'debug',
          },
        },
      });

      const config = await manager.getConfiguration();

      expect(config.logging.level).toBe('debug');
    });
  });

  describe('Validation', () => {
    it('should reject invalid URL values', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          auth: {
            vikunjaUrl: 'not-a-url',
          },
        },
      });

      await expect(manager.getConfiguration()).rejects.toThrow(ConfigurationError);
    });

    it('should reject negative numeric values for rate limits', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: -1,
            },
          },
        },
      });

      await expect(manager.getConfiguration()).rejects.toThrow(ConfigurationError);
    });

    it('should provide detailed validation errors', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: 'not-a-number',
            },
          },
        },
      });

      try {
        await manager.getConfiguration();
        fail('Expected ConfigurationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).toContain('Configuration validation failed');
        expect((error as Error).message).toContain('requestsPerMinute');
      }
    });
  });

  describe('Convenience Methods', () => {
    it('should return auth configuration section', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          auth: {
            vikunjaUrl: 'https://tasks.example.com',
          },
        },
      });

      const authConfig = await manager.getAuthConfig();

      expect(authConfig.vikunjaUrl).toBe('https://tasks.example.com');
      expect(authConfig.vikunjaToken).toBeUndefined();
    });

    it('should return logging configuration section', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          logging: {
            level: 'warn',
          },
        },
      });

      const loggingConfig = await manager.getLoggingConfig();

      expect(loggingConfig.level).toBe('warn');
    });

    it('should return rate limiting configuration section', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: 30,
            },
          },
        },
      });

      const rateLimitConfig = await manager.getRateLimitConfig();

      expect(rateLimitConfig.default.requestsPerMinute).toBe(30);
    });

    it('should check if feature is enabled', () => {
      const isEnabled = ConfigurationManager.getInstance().isFeatureEnabled(
        'enableServerSideFiltering',
      );

      expect(isEnabled).toBe(true);
    });

    it('should return false for disabled features', () => {
      const isEnabled = ConfigurationManager.getInstance().isFeatureEnabled(
        'enableAdvancedMetrics',
      );

      expect(isEnabled).toBe(false);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigurationManager.getInstance();
      const instance2 = ConfigurationManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton for testing', () => {
      const instance1 = ConfigurationManager.getInstance();
      ConfigurationManager.reset();
      const instance2 = ConfigurationManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });
});
