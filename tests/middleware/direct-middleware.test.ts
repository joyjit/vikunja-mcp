/**
 * Behavioral tests for direct middleware helpers
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { AuthManager } from '../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../src/types/errors';
import {
  applyPermissions,
  applyRateLimiting,
  applyBothMiddleware,
} from '../../src/middleware/direct-middleware';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockCheck = jest.fn();
jest.mock('../../src/auth/permissions', () => ({
  PermissionManager: {
    checkToolPermission: (...args: unknown[]) => mockCheck(...args),
  },
}));

jest.mock('../../src/middleware/simplified-rate-limit', () => ({
  withRateLimit: (_tool: string, handler: (...args: unknown[]) => Promise<unknown>) => handler,
}));

describe('direct middleware', () => {
  const handler = jest.fn(async (x: number) => x + 1);
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    authManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockReturnValue({ authType: 'api-token' }),
    } as unknown as AuthManager;
  });

  it('applyPermissions allows authorized calls', async () => {
    mockCheck.mockReturnValue({ hasPermission: true });
    const wrapped = applyPermissions('vikunja_tasks', authManager, handler);
    await expect(wrapped(1)).resolves.toBe(2);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('applyPermissions throws AUTH_REQUIRED when unauthenticated', async () => {
    (authManager.isAuthenticated as jest.Mock).mockReturnValue(false);
    mockCheck.mockReturnValue({
      hasPermission: false,
      errorMessage: 'Please authenticate',
    });

    const wrapped = applyPermissions('vikunja_tasks', authManager, handler);
    await expect(wrapped(1)).rejects.toMatchObject({
      code: ErrorCode.AUTH_REQUIRED,
      message: 'Please authenticate',
    });
  });

  it('applyPermissions throws PERMISSION_DENIED with default message', async () => {
    mockCheck.mockReturnValue({ hasPermission: false });
    const wrapped = applyPermissions('vikunja_users', authManager, handler);
    await expect(wrapped(1)).rejects.toBeInstanceOf(MCPError);
    await expect(wrapped(1)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      message: 'Permission denied',
    });
  });

  it('applyRateLimiting and applyBothMiddleware compose handlers', async () => {
    mockCheck.mockReturnValue({ hasPermission: true });
    const rateLimited = applyRateLimiting('vikunja_tasks', handler);
    await expect(rateLimited(4)).resolves.toBe(5);

    const both = applyBothMiddleware('vikunja_tasks', authManager, handler);
    await expect(both(9)).resolves.toBe(10);
  });
});
