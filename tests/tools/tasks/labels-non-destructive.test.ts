/**
 * Regression: labels are never wiped when updating a task (upstream #92)
 *
 * Real failure (Vikunja v2.4.0): a task had labels [2, 4]; an MCP update with
 * `labels: [3]` reported success and left the task with ZERO labels — the two
 * it had were gone and 3 was never applied.
 *
 * Double cause:
 *  1. `updateTaskLabels` treated the requested set as a REPLACE of the existing one.
 *  2. That bulk endpoint (`POST /tasks/{id}/labels/bulk`) expects `{labels:[…]}`,
 *     but node-vikunja sends `{label_ids:[…]}`. Vikunja drops the unknown field,
 *     reads an empty list, and clears everything.
 *
 * These tests emulate that server: `updateTaskLabels` DESTROYS (as in production)
 * and `addLabelToTask` (`PUT /tasks/{id}/labels`, 201) actually adds. If anyone
 * reverts to bulk or replace semantics, the final set stops being the union and
 * these fail.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { updateTask } from '../../../src/tools/tasks/crud/TaskUpdateService';
import { bulkUpdateTasks } from '../../../src/tools/tasks/bulk-operations';
import { getClientFromContext } from '../../../src/client';
import { isAuthenticationError } from '../../../src/utils/auth-error-handler';
import { withRetry } from '../../../src/utils/retry';

jest.mock('../../../src/client');
jest.mock('../../../src/utils/auth-error-handler');
jest.mock('../../../src/utils/retry');
jest.mock('../../../src/utils/logger');

describe('Labels: update is additive, never destructive (upstream #92)', () => {
  /** Per-task label ids held by the fake server. */
  let serverLabels: Map<number, number[]>;

  const mockClient = {
    tasks: {
      getTask: jest.fn(),
      updateTask: jest.fn(),
      bulkUpdateTasks: jest.fn(),
      addLabelToTask: jest.fn(),
      removeLabelFromTask: jest.fn(),
      updateTaskLabels: jest.fn(),
      assignUserToTask: jest.fn(),
      removeUserFromTask: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    serverLabels = new Map<number, number[]>();

    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    // Bypass timers/breaker — this suite asserts label semantics only.
    (withRetry as jest.Mock).mockImplementation((fn: () => Promise<unknown>) => fn());

    mockClient.tasks.getTask.mockImplementation(async (id: number) => ({
      id,
      title: `Task ${id}`,
      project_id: 1,
      done: false,
      labels: (serverLabels.get(id) ?? []).map((labelId) => ({
        id: labelId,
        title: `label-${labelId}`,
      })),
    }));

    mockClient.tasks.updateTask.mockImplementation(async (id: number, data: unknown) => ({
      ...(data as Record<string, unknown>),
      id,
    }));

    // PUT /tasks/{id}/labels — the individual endpoint that actually works (201).
    mockClient.tasks.addLabelToTask.mockImplementation(
      async (id: number, body: { label_id: number }) => {
        const current = serverLabels.get(id) ?? [];
        if (current.includes(body.label_id)) {
          // Vikunja returns 400 when the label is already present.
          throw new Error('label already exists on task');
        }
        serverLabels.set(id, [...current, body.label_id]);
        return {};
      },
    );

    // POST /tasks/{id}/labels/bulk with {label_ids} — real server behaviour:
    // unknown field dropped → empty list applied → task left with no labels.
    mockClient.tasks.updateTaskLabels.mockImplementation(async (id: number) => {
      serverLabels.set(id, []);
      return {};
    });
  });

  it('update with labels:[3] on a task that has [2,4] keeps both and adds the third', async () => {
    serverLabels.set(331, [2, 4]);

    await updateTask({ id: 331, title: 'Multi-agent protocol', labels: [3] });

    expect([...(serverLabels.get(331) ?? [])].sort()).toEqual([2, 3, 4]);
    // Neither destructive path should be used anymore.
    expect(mockClient.tasks.updateTaskLabels).not.toHaveBeenCalled();
    expect(mockClient.tasks.removeLabelFromTask).not.toHaveBeenCalled();
    // Only the missing label is requested, via one individual call.
    expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledTimes(1);
    expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledWith(331, {
      task_id: 331,
      label_id: 3,
    });
  });

  it('re-requesting a label that is already present is a no-op', async () => {
    serverLabels.set(331, [2, 4]);

    await updateTask({ id: 331, labels: [2, 4] });

    expect([...(serverLabels.get(331) ?? [])].sort()).toEqual([2, 4]);
    expect(mockClient.tasks.addLabelToTask).not.toHaveBeenCalled();
  });

  it('an update that omits labels leaves existing labels intact', async () => {
    serverLabels.set(331, [2, 4]);

    await updateTask({ id: 331, title: 'Title only change' });

    expect([...(serverLabels.get(331) ?? [])].sort()).toEqual([2, 4]);
    expect(mockClient.tasks.addLabelToTask).not.toHaveBeenCalled();
    expect(mockClient.tasks.updateTaskLabels).not.toHaveBeenCalled();
  });

  it('bulk-update labels across 3 tasks adds without wiping each task’s existing set', async () => {
    // Each task starts with different labels; the bug wiped all three at once.
    serverLabels.set(101, [2, 4]);
    serverLabels.set(102, [4]);
    serverLabels.set(103, []);

    // Fork never calls native bulkUpdateTasks; keep the mock rejected for clarity.
    mockClient.tasks.bulkUpdateTasks.mockRejectedValue(new Error('bulk endpoint: invalid field'));

    await bulkUpdateTasks({ taskIds: [101, 102, 103], field: 'labels', value: [3] });

    expect([...(serverLabels.get(101) ?? [])].sort()).toEqual([2, 3, 4]);
    expect([...(serverLabels.get(102) ?? [])].sort()).toEqual([3, 4]);
    expect([...(serverLabels.get(103) ?? [])].sort()).toEqual([3]);
    expect(mockClient.tasks.updateTaskLabels).not.toHaveBeenCalled();
    expect(mockClient.tasks.removeLabelFromTask).not.toHaveBeenCalled();
    expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledTimes(3);
  });
});
