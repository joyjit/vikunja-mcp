/**
 * Unit tests for task filter evaluation helpers
 */

import { describe, it, expect } from '@jest/globals';
import type { Task } from 'node-vikunja';
import type { FilterCondition, FilterExpression } from '../../src/types/filters';
import {
  evaluateCondition,
  evaluateComparison,
  evaluateDateComparison,
  parseRelativeDate,
  evaluateStringComparison,
  evaluateArrayComparison,
  evaluateGroup,
  applyFilter,
} from '../../src/tools/tasks/filtering/evaluators';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Sample task',
    description: 'A description',
    done: false,
    priority: 2,
    percent_done: 10,
    due_date: '2024-06-15T12:00:00Z',
    created: '2024-01-01T00:00:00Z',
    updated: '2024-02-01T00:00:00Z',
    assignees: [{ id: 10, username: 'alice' }],
    labels: [{ id: 5, title: 'bug' }],
    ...overrides,
  } as Task;
}

describe('filter evaluators', () => {
  describe('evaluateComparison', () => {
    it('handles equality and inequality', () => {
      expect(evaluateComparison(1, '=', 1)).toBe(true);
      expect(evaluateComparison(1, '!=', 2)).toBe(true);
      expect(evaluateComparison(1, '!=', 1)).toBe(false);
    });

    it('handles numeric inequalities', () => {
      expect(evaluateComparison(5, '>', 3)).toBe(true);
      expect(evaluateComparison(5, '>=', 5)).toBe(true);
      expect(evaluateComparison(2, '<', 3)).toBe(true);
      expect(evaluateComparison(2, '<=', 2)).toBe(true);
    });

    it('returns false for unknown operators', () => {
      expect(evaluateComparison(1, '~~', 1)).toBe(false);
    });
  });

  describe('parseRelativeDate', () => {
    it('parses ISO dates', () => {
      const d = parseRelativeDate('2024-06-15');
      expect(d).toBeInstanceOf(Date);
      expect(d!.toISOString().startsWith('2024-06-15')).toBe(true);
    });

    it('parses now and relative offsets for each unit', () => {
      expect(parseRelativeDate('now')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+5s')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now-1m')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+2h')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+3d')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+1w')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+1M')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+1y')).toBeInstanceOf(Date);
      expect(parseRelativeDate('now+2')).toBeInstanceOf(Date); // default days
    });

    it('returns null for invalid strings', () => {
      expect(parseRelativeDate('tomorrow')).toBeNull();
      expect(parseRelativeDate('not-a-date')).toBeNull();
    });
  });

  describe('evaluateDateComparison', () => {
    const day = '2024-06-15T08:00:00Z';

    it('compares dates with all operators', () => {
      const stamp = '2024-06-15T12:00:00.000Z';
      expect(evaluateDateComparison(stamp, '=', stamp)).toBe(true);
      expect(evaluateDateComparison(stamp, '!=', '2024-06-16T12:00:00.000Z')).toBe(true);
      expect(evaluateDateComparison(stamp, '>', '2024-06-14T12:00:00.000Z')).toBe(true);
      expect(evaluateDateComparison(stamp, '>=', stamp)).toBe(true);
      expect(evaluateDateComparison(stamp, '<', '2024-06-16T12:00:00.000Z')).toBe(true);
      expect(evaluateDateComparison(stamp, '<=', stamp)).toBe(true);
    });

    it('returns false for invalid expected date or operator', () => {
      expect(evaluateDateComparison(day, '=', 'bad-date')).toBe(false);
      expect(evaluateDateComparison(day, '~~', '2024-06-15')).toBe(false);
    });
  });

  describe('evaluateStringComparison', () => {
    it('supports equality, inequality, and like', () => {
      expect(evaluateStringComparison('Hello', '=', 'Hello')).toBe(true);
      expect(evaluateStringComparison('Hello', '!=', 'Bye')).toBe(true);
      expect(evaluateStringComparison('Hello World', 'like', 'hello')).toBe(true);
      expect(evaluateStringComparison('Hello', 'regex', 'H')).toBe(false);
    });
  });

  describe('evaluateArrayComparison', () => {
    it('supports in and not in', () => {
      expect(evaluateArrayComparison([1, 2, 3], 'in', [2])).toBe(true);
      expect(evaluateArrayComparison([1, 2, 3], 'not in', [9])).toBe(true);
      expect(evaluateArrayComparison([1, 2, 3], 'not in', [2])).toBe(false);
      expect(evaluateArrayComparison([1], '=', [1])).toBe(false);
    });
  });

  describe('evaluateCondition', () => {
    const task = makeTask();

    it('evaluates done, priority, and percentDone', () => {
      expect(evaluateCondition(task, { field: 'done', operator: '=', value: false })).toBe(true);
      expect(evaluateCondition(task, { field: 'done', operator: '=', value: 'true' })).toBe(false);
      expect(evaluateCondition(task, { field: 'priority', operator: '>=', value: 2 })).toBe(true);
      expect(evaluateCondition(task, { field: 'percentDone', operator: '<', value: 50 })).toBe(true);
    });

    it('handles missing optional numeric fields as zero', () => {
      const sparse = makeTask({ priority: undefined, percent_done: undefined });
      expect(evaluateCondition(sparse, { field: 'priority', operator: '=', value: 0 })).toBe(true);
      expect(evaluateCondition(sparse, { field: 'percentDone', operator: '=', value: 0 })).toBe(true);
    });

    it('handles due dates including null', () => {
      const stamp = '2024-06-15T12:00:00.000Z';
      const withDue = makeTask({ due_date: stamp });
      expect(evaluateCondition(withDue, { field: 'dueDate', operator: '=', value: stamp })).toBe(true);
      const noDue = makeTask({ due_date: undefined });
      expect(evaluateCondition(noDue, { field: 'dueDate', operator: '!=', value: stamp })).toBe(true);
      expect(evaluateCondition(noDue, { field: 'dueDate', operator: '=', value: stamp })).toBe(false);
    });

    it('handles created and updated with missing values', () => {
      const stampCreated = '2024-01-01T00:00:00.000Z';
      const stampUpdated = '2024-02-01T00:00:00.000Z';
      const dated = makeTask({ created: stampCreated, updated: stampUpdated });
      expect(evaluateCondition(dated, { field: 'created', operator: '=', value: stampCreated })).toBe(true);
      expect(evaluateCondition(dated, { field: 'updated', operator: '=', value: stampUpdated })).toBe(true);
      const bare = makeTask({ created: undefined, updated: undefined });
      expect(evaluateCondition(bare, { field: 'created', operator: '=', value: '2024-01-01' })).toBe(false);
      expect(evaluateCondition(bare, { field: 'updated', operator: '=', value: '2024-02-01' })).toBe(false);
    });

    it('evaluates title and description', () => {
      expect(evaluateCondition(task, { field: 'title', operator: 'like', value: 'sample' })).toBe(true);
      expect(evaluateCondition(task, { field: 'description', operator: 'like', value: 'desc' })).toBe(true);
      const noDesc = makeTask({ description: undefined });
      expect(evaluateCondition(noDesc, { field: 'description', operator: '=', value: '' })).toBe(true);
    });

    it('evaluates assignees and labels as arrays or scalars', () => {
      expect(evaluateCondition(task, { field: 'assignees', operator: 'in', value: [10] })).toBe(true);
      expect(evaluateCondition(task, { field: 'assignees', operator: 'in', value: 10 })).toBe(true);
      expect(evaluateCondition(task, { field: 'labels', operator: 'in', value: [5] })).toBe(true);
      expect(evaluateCondition(task, { field: 'labels', operator: 'in', value: 5 })).toBe(true);

      const empty = makeTask({ assignees: undefined, labels: [{ id: undefined, title: 'x' } as never] });
      expect(evaluateCondition(empty, { field: 'assignees', operator: 'in', value: [1] })).toBe(false);
      expect(evaluateCondition(empty, { field: 'labels', operator: 'in', value: [1] })).toBe(false);
    });

    it('returns false for unknown fields', () => {
      expect(
        evaluateCondition(task, { field: 'unknown' as FilterCondition['field'], operator: '=', value: 1 }),
      ).toBe(false);
    });
  });

  describe('evaluateGroup and applyFilter', () => {
    const tasks = [
      makeTask({ id: 1, done: false, priority: 1 }),
      makeTask({ id: 2, done: true, priority: 5 }),
      makeTask({ id: 3, done: false, priority: 5 }),
    ];

    it('evaluates AND and OR groups', () => {
      const andGroup = {
        operator: '&&' as const,
        conditions: [
          { field: 'done' as const, operator: '=' as const, value: false },
          { field: 'priority' as const, operator: '=' as const, value: 5 },
        ],
      };
      expect(evaluateGroup(tasks[2]!, andGroup)).toBe(true);
      expect(evaluateGroup(tasks[0]!, andGroup)).toBe(false);

      const orGroup = {
        operator: '||' as const,
        conditions: [
          { field: 'done' as const, operator: '=' as const, value: true },
          { field: 'priority' as const, operator: '=' as const, value: 1 },
        ],
      };
      expect(evaluateGroup(tasks[0]!, orGroup)).toBe(true);
      expect(evaluateGroup(tasks[1]!, orGroup)).toBe(true);
    });

    it('applies multi-group expressions with && and ||', () => {
      const andExpr: FilterExpression = {
        operator: '&&',
        groups: [
          {
            operator: '&&',
            conditions: [{ field: 'done', operator: '=', value: false }],
          },
          {
            operator: '&&',
            conditions: [{ field: 'priority', operator: '>=', value: 5 }],
          },
        ],
      };
      expect(applyFilter(tasks, andExpr).map((t) => t.id)).toEqual([3]);

      const orExpr: FilterExpression = {
        operator: '||',
        groups: [
          {
            operator: '&&',
            conditions: [{ field: 'done', operator: '=', value: true }],
          },
          {
            operator: '&&',
            conditions: [{ field: 'priority', operator: '=', value: 1 }],
          },
        ],
      };
      expect(applyFilter(tasks, orExpr).map((t) => t.id).sort()).toEqual([1, 2]);

      const defaultAnd: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions: [{ field: 'priority', operator: '=', value: 5 }],
          },
        ],
      };
      expect(applyFilter(tasks, defaultAnd).map((t) => t.id).sort()).toEqual([2, 3]);
    });
  });
});
