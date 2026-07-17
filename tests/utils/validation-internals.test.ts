/**
 * Coverage for validation deep-copy / sanitize helpers
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  validationInternals,
  safeJsonStringify,
  safeJsonParse,
  validateValue,
  validateFilterExpression,
} from '../../src/utils/validation';
import { MCPError } from '../../src/types';

describe('validationInternals', () => {
  const { createSafeObjectCopy, sanitizeObjectStrings, isSafeProperty, containsPrototypePollution } =
    validationInternals;

  it('copies primitives, dates, arrays, and skips unsafe keys', () => {
    expect(createSafeObjectCopy(null)).toBeNull();
    expect(createSafeObjectCopy(5)).toBe(5);
    expect(createSafeObjectCopy(new Date('2024-01-01'))).toBeInstanceOf(Date);
    expect(createSafeObjectCopy([1, { a: 2 }])).toEqual([1, { a: 2 }]);

    const withProto = JSON.parse('{"ok":1,"__proto__":{"x":1}}');
    expect(createSafeObjectCopy(withProto)).toEqual({ ok: 1 });
    expect(isSafeProperty('__proto__')).toBe(false);
  });

  it('returns null for nested circular references', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(createSafeObjectCopy(circular)).toEqual({ a: 1, self: null });
    expect(sanitizeObjectStrings(circular)).toEqual({ a: 1, self: null });
  });

  it('sanitizes strings but preserves operators and dates', () => {
    expect(sanitizeObjectStrings('=')).toBe('=');
    expect(sanitizeObjectStrings(new Date('2024-06-01'))).toBeInstanceOf(Date);
    expect(sanitizeObjectStrings({ title: '<b>x</b>', op: '=' })).toMatchObject({
      op: '=',
    });
  });

  it('detects prototype pollution patterns', () => {
    expect(containsPrototypePollution('{"__proto__":{}}')).toBe(true);
    expect(containsPrototypePollution('{"title":"ok"}')).toBe(false);
  });

  it('safeJsonParse / stringify round-trip valid filters', () => {
    const expr = {
      groups: [
        {
          operator: '&&',
          conditions: [{ field: 'done', operator: '=', value: false }],
        },
      ],
    };
    const json = safeJsonStringify(expr);
    expect(safeJsonParse(json).groups).toHaveLength(1);
  });

  it('wraps unexpected stringify/parse failures', () => {
    const expr = {
      groups: [
        {
          operator: '&&',
          conditions: [{ field: 'done', operator: '=', value: false }],
        },
      ],
    };
    const stringifySpy = jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw 'stringify-fail';
    });
    expect(() => safeJsonStringify(expr)).toThrow(/Failed to stringify/);
    stringifySpy.mockRestore();

    const parseSpy = jest.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'parse-fail';
    });
    expect(() => safeJsonParse('{"groups":[]}')).toThrow(/Failed to parse JSON|Invalid JSON|must have/);
    parseSpy.mockRestore();
  });

  it('validateValue rejects bad arrays and accepts string/number arrays', () => {
    expect(validateValue(['a', 'b'])).toEqual(['a', 'b']);
    expect(validateValue([1, 2])).toEqual([1, 2]);
    expect(() => validateValue([1, 'x'])).toThrow(MCPError);
    expect(() => validateValue([Number.NaN])).toThrow(MCPError);
    expect(() => validateValue([{}])).toThrow(MCPError);
  });

  it('rejects filter expressions with too many groups', () => {
    const groups = Array.from({ length: 11 }, () => ({
      operator: '&&' as const,
      conditions: [{ field: 'done' as const, operator: '=' as const, value: false }],
    }));
    expect(() => validateFilterExpression({ groups })).toThrow(/nesting depth|at most/i);
  });
});
