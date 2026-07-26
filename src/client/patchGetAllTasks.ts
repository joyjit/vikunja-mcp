/**
 * node-vikunja 0.4.0 calls GET /tasks/all for getAllTasks().
 * Vikunja 2.x does not serve that path (HTTP 400, code 2004).
 * The correct path is GET /tasks.
 *
 * Remove this shim once node-vikunja publishes a fix
 * (democratize-technology/node-vikunja#4 / vikunja-mcp#40).
 */

import type { GetTasksParams, Task, VikunjaClient } from 'node-vikunja';

interface TaskServiceWithRequest {
  getAllTasks(params?: GetTasksParams): Promise<Task[]>;
  request(
    endpoint: string,
    method: string,
    body?: unknown,
    options?: { params?: GetTasksParams },
  ): Promise<Task[]>;
}

export function patchGetAllTasksForVikunja2(client: VikunjaClient): void {
  const tasks = client.tasks as unknown as TaskServiceWithRequest | undefined;
  if (!tasks || typeof tasks.request !== 'function') {
    return;
  }

  const request = tasks.request.bind(tasks);
  tasks.getAllTasks = (params?: GetTasksParams): Promise<Task[]> =>
    request('/tasks', 'GET', undefined, params !== undefined ? { params } : {});
}
