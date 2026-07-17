/**
 * Small coverage helpers for previously untested exports
 */

import { describe, it, expect } from '@jest/globals';
import { StorageDataError } from '../../src/utils/storage-errors';
import { isMCPError, hasStatusCode } from '../../src/utils/error-handler';
import { MCPError, ErrorCode } from '../../src/types/errors';
import { createTaskErrorResponse } from '../../src/tools/tasks/crud/TaskResponseFormatter';
import { createCircuitBreaker, getHealthStats } from '../../src/utils/retry';
import { SimplifiedRateLimitMiddleware } from '../../src/middleware/simplified-rate-limit';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('misc coverage helpers', () => {
  it('StorageDataError stores optional cause', () => {
    const cause = new Error('root');
    const err = new StorageDataError('bad data', 'CUSTOM', cause);
    expect(err.name).toBe('StorageDataError');
    expect(err.code).toBe('CUSTOM');
    expect(err.cause).toBe(cause);

    const plain = new StorageDataError('plain');
    expect(plain.code).toBe('STORAGE_DATA_ERROR');
    expect(plain.cause).toBeUndefined();
  });

  it('type guards recognize MCP and status-code errors', () => {
    expect(isMCPError(new MCPError(ErrorCode.API_ERROR, 'x'))).toBe(true);
    expect(isMCPError(new Error('x'))).toBe(false);
    expect(hasStatusCode({ statusCode: 500 })).toBe(true);
    expect(hasStatusCode(null)).toBe(false);
    expect(hasStatusCode('nope')).toBe(false);
  });

  it('createTaskErrorResponse handles Error, message objects, and unknowns', () => {
    const fromError = createTaskErrorResponse('create', new Error('boom'), {
      timestamp: '2024-01-01T00:00:00Z',
      sessionId: 's1',
    });
    expect(fromError.response.immediate.status).toBe('error');
    expect(fromError.response.summary).toBe('boom');

    const fromObj = createTaskErrorResponse('update', { message: 'obj', code: 'E1' });
    expect(fromObj.response.summary).toBe('obj');

    const fromUnknown = createTaskErrorResponse('delete', { other: true });
    expect(fromUnknown.response.summary).toBe('Unknown error occurred');
  });

  it('fires circuit breaker open/close log handlers and health stats', async () => {
    const breaker = createCircuitBreaker(async () => 'ok', 'cov-breaker-events', {
      timeout: 50,
      resetTimeout: 10,
      errorThresholdPercentage: 1,
      volumeThreshold: 1,
    });

    breaker.emit('open');
    breaker.emit('close');
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
    expect(getHealthStats(breaker)).toBeDefined();
  });

  it('rate-limit circuit breaker event handlers log state changes', () => {
    const middleware = new SimplifiedRateLimitMiddleware(undefined, true);
    const minute = (middleware as unknown as {
      minuteStoreBreaker: { emit: (e: string) => void };
    }).minuteStoreBreaker;
    const hour = (middleware as unknown as {
      hourStoreBreaker: { emit: (e: string) => void };
    }).hourStoreBreaker;

    minute.emit('open');
    minute.emit('halfOpen');
    minute.emit('close');
    hour.emit('open');
    hour.emit('halfOpen');
    hour.emit('close');

    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();

    middleware.clearSession();
  });
});
