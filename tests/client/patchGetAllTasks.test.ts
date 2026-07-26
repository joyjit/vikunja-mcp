/**
 * Tests for Vikunja 2.x getAllTasks path shim (/tasks instead of /tasks/all)
 */

import { describe, it, expect, jest } from '@jest/globals';
import { patchGetAllTasksForVikunja2 } from '../../src/client/patchGetAllTasks';
import type { VikunjaClient } from 'node-vikunja';

describe('patchGetAllTasksForVikunja2', () => {
  it('rewrites getAllTasks to call GET /tasks with params', async () => {
    const request = jest.fn().mockResolvedValue([{ id: 1, title: 'Task' }]);
    const client = {
      tasks: {
        getAllTasks: jest.fn(),
        request,
      },
    } as unknown as VikunjaClient;

    patchGetAllTasksForVikunja2(client);

    const params = { per_page: 1, page: 2 };
    const result = await client.tasks.getAllTasks(params);

    expect(request).toHaveBeenCalledWith('/tasks', 'GET', undefined, { params });
    expect(request).not.toHaveBeenCalledWith(
      '/tasks/all',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result).toEqual([{ id: 1, title: 'Task' }]);
  });

  it('omits params option when none are provided', async () => {
    const request = jest.fn().mockResolvedValue([]);
    const client = {
      tasks: {
        getAllTasks: jest.fn(),
        request,
      },
    } as unknown as VikunjaClient;

    patchGetAllTasksForVikunja2(client);
    await client.tasks.getAllTasks();

    expect(request).toHaveBeenCalledWith('/tasks', 'GET', undefined, {});
  });

  it('is a no-op when tasks.request is missing', () => {
    const getAllTasks = jest.fn();
    const client = {
      tasks: { getAllTasks },
    } as unknown as VikunjaClient;

    expect(() => patchGetAllTasksForVikunja2(client)).not.toThrow();
    expect(client.tasks.getAllTasks).toBe(getAllTasks);
  });

  it('is a no-op when tasks is missing', () => {
    const client = {} as VikunjaClient;
    expect(() => patchGetAllTasksForVikunja2(client)).not.toThrow();
  });
});
