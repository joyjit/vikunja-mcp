/**
 * Coverage for createErrorResponse helper
 */

import { describe, it, expect } from '@jest/globals';
import { createErrorResponse } from '../../src/types/responses';

describe('createErrorResponse', () => {
  it('creates a minimal error response', () => {
    expect(createErrorResponse('create', 'failed')).toEqual({
      success: false,
      operation: 'create',
      message: 'failed',
    });
  });

  it('includes optional code and details when provided', () => {
    expect(
      createErrorResponse('update', 'nope', 'VALIDATION_ERROR', { field: 'id' }),
    ).toEqual({
      success: false,
      operation: 'update',
      message: 'nope',
      code: 'VALIDATION_ERROR',
      details: { field: 'id' },
    });
  });
});
