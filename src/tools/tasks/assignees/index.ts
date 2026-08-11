/**
 * Assignee operations for tasks
 * Refactored to use modular service architecture
 */

import { MCPError, ErrorCode } from '../../../types';
import {
  AssigneeOperationsService,
  addAssigneesToTaskAdditive,
  findMissingAssigneeIds,
} from './AssigneeOperationsService';
import { AssigneeValidationService } from './AssigneeValidationService';
import { AssigneeResponseFormatter } from './AssigneeResponseFormatter';

export { addAssigneesToTaskAdditive, findMissingAssigneeIds };

/**
 * Assign users to a task
 */
export async function assignUsers(args: {
  id?: number;
  assignees?: number[];
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, assigneeIds } = AssigneeValidationService.validateAssignInput(args);

    // Perform the assignment operation (per-user PUT — bulk {user_ids} is a silent no-op)
    await AssigneeOperationsService.assignUsersToTask(taskId, assigneeIds);

    // Fetch once and verify assignees actually persisted
    const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);
    const missingIds = findMissingAssigneeIds(task.assignees, assigneeIds);

    const response = AssigneeResponseFormatter.formatAssignResponse(task);
    if (missingIds.length > 0) {
      response.success = false;
      response.message =
        `Assignee operation reported success, but user(s) [${missingIds.join(', ')}] were not persisted. ` +
        `Vikunja accepted the request without applying it (known silent no-op on the bulk assignee API).`;
    }
    return AssigneeResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to assign users to task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Unassign users from a task
 */
export async function unassignUsers(args: {
  id?: number;
  assignees?: number[];
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, userIds } = AssigneeValidationService.validateUnassignInput(args);

    // Perform the unassignment operation
    await AssigneeOperationsService.removeUsersFromTask(taskId, userIds);

    // Fetch updated task data
    const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);

    // Format and return response
    const response = AssigneeResponseFormatter.formatUnassignResponse(task);
    return AssigneeResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to remove users from task: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List assignees of a task
 */
export async function listAssignees(args: {
  id?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId } = AssigneeValidationService.validateListInput(args);

    // Fetch task data
    const task = await AssigneeOperationsService.fetchTaskWithAssignees(taskId);

    // Create minimal task representation with assignees
    const minimalTask = AssigneeOperationsService.createMinimalTaskWithAssignees(task);
    const assigneeCount = AssigneeOperationsService.extractAssignees(task).length;

    // Format and return response
    const response = AssigneeResponseFormatter.formatListAssigneesResponse(minimalTask, assigneeCount);
    return AssigneeResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to list task assignees: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
