/**
 * Edge-case coverage for filter parsing, validation, and client-side apply
 */

import { describe, it, expect } from '@jest/globals';
import {
  SecurityValidator,
  parseFilterString,
  validateCondition,
  validateFilterExpression,
  conditionToString,
  groupToString,
  FilterBuilder,
  applyClientSideFilter,
  type SimpleFilter,
} from '../../src/utils/filters';
import type { FilterCondition, FilterExpression } from '../../src/types/filters';

describe('filters edge cases', () => {
  describe('SecurityValidator.validateValue', () => {
    it('rejects values over the max length and accepts short ones', () => {
      expect(SecurityValidator.validateValue('ok')).toEqual({ isValid: true });
      expect(SecurityValidator.validateValue('x'.repeat(201)).isValid).toBe(false);
    });
  });

  describe('parseFilterString edge cases', () => {
    it('handles escaped quotes inside quoted values', () => {
      const result = parseFilterString('title = "say \\"hi\\""');
      expect(result.error).toBeUndefined();
      expect(result.expression).toBeTruthy();
    });

    it('rejects unclosed quotes', () => {
      const result = parseFilterString('title = "unclosed');
      expect(result.expression).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('rejects missing operators and parentheses', () => {
      expect(parseFilterString('done true').expression).toBeNull();
      expect(parseFilterString('(done = true').expression).toBeNull();
    });
  });

  describe('validateCondition field-type rules', () => {
    it('rejects invalid operators for boolean and array fields', () => {
      expect(
        validateCondition({ field: 'done', operator: '>', value: true } as FilterCondition),
      ).toEqual(expect.arrayContaining([expect.stringContaining('boolean')]));

      expect(
        validateCondition({ field: 'labels', operator: '>', value: [1] } as FilterCondition),
      ).toEqual(expect.arrayContaining([expect.stringContaining('array field')]));
    });

    it('rejects wrong value types', () => {
      expect(
        validateCondition({ field: 'done', operator: '=', value: 123 } as FilterCondition),
      ).toEqual(expect.arrayContaining([expect.stringContaining('boolean value')]));

      expect(
        validateCondition({ field: 'done', operator: '=', value: 'true' }),
      ).toHaveLength(0);

      expect(
        validateCondition({ field: 'labels', operator: 'in', value: 5 } as FilterCondition),
      ).toEqual(expect.arrayContaining([expect.stringContaining('array or comma-separated')]));

      expect(
        validateCondition({ field: 'dueDate', operator: '=', value: 'not-a-date' }),
      ).toEqual(expect.arrayContaining([expect.stringContaining('valid date')]));
    });

    it('maps zod enum failures to Invalid field name', () => {
      expect(
        validateCondition({ field: 'nope' as never, operator: '=', value: true }),
      ).toEqual(['Invalid field name']);
    });
  });

  describe('validateFilterExpression edge cases', () => {
    it('rejects empty groups and invalid schema shapes', () => {
      const emptyGroup: FilterExpression = {
        groups: [{ operator: '&&', conditions: [] }],
      };
      const emptyResult = validateFilterExpression(emptyGroup);
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.errors.some((e) => e.includes('at least one condition'))).toBe(true);

      const badSchema = validateFilterExpression({ groups: 'nope' } as never);
      expect(badSchema.valid).toBe(false);
      expect(badSchema.errors.length).toBeGreaterThan(0);
    });
  });

  describe('conditionToString with arrays', () => {
    it('joins array values with commas', () => {
      expect(
        conditionToString({
          field: 'labels',
          operator: 'in',
          value: [1, 2, 3],
        }),
      ).toContain('1, 2, 3');
    });
  });

  describe('FilterBuilder grouping helpers', () => {
    it('supports and/group/groupOperator/validate', () => {
      const builder = new FilterBuilder()
        .where('done', '=', false)
        .and()
        .group() // default &&
        .where('priority', '>', 3)
        .groupOperator('&&');

      const built = builder.build();
      expect(built.groups.length).toBeGreaterThanOrEqual(1);
      expect(built.operator).toBe('&&');

      const validation = builder.validate();
      expect(validation.valid).toBe(true);
    });
  });

  describe('groupToString and applyClientSideFilter defaults', () => {
    it('handles empty groups and unknown operators', () => {
      expect(groupToString({ operator: '&&', conditions: [] })).toBe('');

      expect(
        applyClientSideFilter(
          [{ title: 'x' }],
          { field: 'title', operator: 'weird' as never, value: 'x' },
        ),
      ).toEqual([{ title: 'x' }]);
    });
  });

  describe('applyClientSideFilter operators', () => {
    const tasks = [
      {
        title: 'Alpha',
        priority: 5,
        due_date: '2024-06-15',
        tags: ['a', 'b'],
        ids: [1, 2],
        weird: [{ x: 1 }],
      },
      {
        title: 'Beta',
        priority: 1,
        due_date: '2024-01-01',
        tags: ['c'],
        ids: [3],
        weird: [{ x: 2 }],
      },
    ];

    it('handles inequality and comparison operators', () => {
      expect(applyClientSideFilter(tasks, { field: 'priority', operator: '!=', value: 5 })).toHaveLength(1);
      expect(applyClientSideFilter(tasks, { field: 'priority', operator: '>', value: 3 })).toHaveLength(1);
      expect(applyClientSideFilter(tasks, { field: 'priority', operator: '>=', value: 5 })).toHaveLength(1);
      expect(applyClientSideFilter(tasks, { field: 'priority', operator: '<', value: 3 })).toHaveLength(1);
      expect(applyClientSideFilter(tasks, { field: 'priority', operator: '<=', value: 1 })).toHaveLength(1);
    });

    it('compares date strings and rejects array comparisons for scalars', () => {
      expect(
        applyClientSideFilter(tasks, { field: 'due_date', operator: '>', value: '2024-03-01' }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, { field: 'due_date', operator: '>=', value: '2024-06-15' }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, { field: 'due_date', operator: '<', value: '2024-03-01' }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, { field: 'due_date', operator: '<=', value: '2024-01-01' }),
      ).toHaveLength(1);

      // array task values cannot use scalar comparison operators
      expect(
        applyClientSideFilter(tasks, { field: 'ids', operator: '>', value: 1 } as SimpleFilter),
      ).toHaveLength(0);
    });

    it('handles in / not in for scalars and arrays', () => {
      expect(
        applyClientSideFilter(tasks, { field: 'priority', operator: 'in', value: [5, 9] }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, { field: 'priority', operator: 'in', value: 5 } as SimpleFilter),
      ).toHaveLength(0);
      expect(
        applyClientSideFilter(tasks, { field: 'ids', operator: 'in', value: [2] }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, { field: 'priority', operator: 'not in', value: [5] }),
      ).toHaveLength(1);
      expect(
        applyClientSideFilter(tasks, {
          field: 'priority',
          operator: 'not in',
          value: 5,
        } as SimpleFilter),
      ).toHaveLength(2);
      expect(
        applyClientSideFilter(tasks, { field: 'ids', operator: 'not in', value: [2] }),
      ).toHaveLength(1);
    });

    it('ignores non-primitive task properties', () => {
      expect(
        applyClientSideFilter(tasks, { field: 'weird', operator: '=', value: null } as SimpleFilter),
      ).toHaveLength(0);
    });
  });
});
