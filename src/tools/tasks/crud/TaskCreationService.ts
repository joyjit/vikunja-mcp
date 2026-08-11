/**
 * Task Creation Service
 * Handles task creation with label/assignee management and rollback logic
 */

import { MCPError, ErrorCode } from '../../../types';
import { getClientFromContext } from '../../../client';
import type { Task, VikunjaClient } from 'node-vikunja';
import { logger } from '../../../utils/logger';
import { isAuthenticationError } from '../../../utils/auth-error-handler';
import { RETRY_CONFIG } from '../../../utils/retry';
import { transformApiError, handleFetchError } from '../../../utils/error-handler';
import { sanitizeString } from '../../../utils/validation';
import { addLabelsToTaskAdditive } from '../labels';
import { addAssigneesToTaskAdditive, findMissingAssigneeIds } from '../assignees';
import { AUTH_ERROR_MESSAGES } from '../constants';
import { validateDateString, validateId, convertRepeatConfiguration, validatePercentDone } from '../validation';
import { createTaskResponse } from './TaskResponseFormatter';
import { formatAorpAsMarkdown } from '../../../utils/response-factory';

export interface CreateTaskArgs {
  projectId?: number;
  title?: string;
  description?: string;
  dueDate?: string;
  priority?: number;
  /** Completion percentage (0–100), mapped to Vikunja `percent_done`. */
  percentDone?: number;
  labels?: number[];
  assignees?: number[];
  repeatAfter?: number;
  repeatMode?: 'day' | 'week' | 'month' | 'year';
  // Session ID for AORP response tracking
  sessionId?: string;
}

/**
 * Internal interface for tracking creation state during rollback scenarios
 */
interface CreationState {
  createdTask: Task;
  labelsAdded: boolean;
  assigneesAdded: boolean;
}

/**
 * Creates a new task with comprehensive error handling and rollback support
 */
export async function createTask(args: CreateTaskArgs): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Validate required fields
    if (!args.projectId) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'projectId is required to create a task');
    }
    validateId(args.projectId, 'projectId');

    if (!args.title) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'title is required to create a task');
    }

    // Pass title/description through unchanged (thin Vikunja wrapper)
    const sanitizedTitle = sanitizeString(args.title);
    // Preserve empty strings as they are valid descriptions
    const sanitizedDescription = args.description !== undefined ? sanitizeString(args.description) : undefined;

    // Validate optional date fields
    if (args.dueDate) {
      validateDateString(args.dueDate, 'dueDate');
    }

    if (args.percentDone !== undefined) {
      validatePercentDone(args.percentDone);
    }

    // Validate assignee IDs upfront
    if (args.assignees && args.assignees.length > 0) {
      args.assignees.forEach((id) => validateId(id, 'assignee ID'));
    }

    // Validate label IDs upfront
    if (args.labels && args.labels.length > 0) {
      args.labels.forEach((id) => validateId(id, 'label ID'));
    }

    const client = await getClientFromContext();

    // Build the initial task object with sanitized values
    const newTask: Task = {
      title: sanitizedTitle,
      project_id: args.projectId,
    };

    // Add optional fields with sanitized values
    if (sanitizedDescription !== undefined) newTask.description = sanitizedDescription;
    if (args.dueDate !== undefined) newTask.due_date = args.dueDate;
    if (args.priority !== undefined) newTask.priority = args.priority;
    if (args.percentDone !== undefined) newTask.percent_done = args.percentDone;

    // Handle repeat configuration
    if (args.repeatAfter !== undefined || args.repeatMode !== undefined) {
      const repeatConfig = convertRepeatConfiguration(args.repeatAfter, args.repeatMode);
      if (repeatConfig.repeat_after !== undefined) newTask.repeat_after = repeatConfig.repeat_after;
      if (repeatConfig.repeat_mode !== undefined) {
        // Use index signature to bypass type mismatch - API expects number but node-vikunja types expect string
        (newTask as Record<string, unknown>).repeat_mode = repeatConfig.repeat_mode;
      }
    }

    // Create the base task
    const createdTask = await client.tasks.createTask(args.projectId, newTask);

    // Labels/assignees require a task id — fail loudly instead of reporting success without them
    const needsPostCreate =
      (args.labels !== undefined && args.labels.length > 0) ||
      (args.assignees !== undefined && args.assignees.length > 0);
    if (needsPostCreate && !createdTask.id) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        'Task was created but Vikunja did not return a task id, so labels/assignees could not be applied',
      );
    }

    // Track creation state for potential rollback
    const creationState: CreationState = {
      createdTask,
      labelsAdded: false,
      assigneesAdded: false
    };

    try {
      // Add labels if provided
      if (args.labels && args.labels.length > 0 && createdTask.id) {
        await addLabelsToTask(client, createdTask.id, args.labels);
        creationState.labelsAdded = true;
      }

      // Add assignees if provided
      if (args.assignees && args.assignees.length > 0 && createdTask.id) {
        await addAssigneesToTask(client, createdTask.id, args.assignees);
        creationState.assigneesAdded = true;
      }

    } catch (updateError) {
      // Attempt to clean up the partially created task
      await rollbackTaskCreation(client, creationState, updateError);
      // The rollback function will re-throw the original error with context
    }

    // Fetch the complete task with labels and assignees
    const completeTask = createdTask.id ? await client.tasks.getTask(createdTask.id) : createdTask;

    // Verify labels actually stuck — avoid silent success when the API no-ops
    if (args.labels && args.labels.length > 0) {
      const attachedIds = new Set(
        (completeTask.labels || [])
          .map((label) => label.id)
          .filter((id): id is number => typeof id === 'number'),
      );
      const missing = args.labels.filter((id) => !attachedIds.has(id));
      if (missing.length > 0) {
        await rollbackTaskCreation(
          client,
          creationState,
          new Error(
            `Labels were requested but not attached after create (missing label ids: ${missing.join(', ')})`,
          ),
        );
      }
    }

    // Verify assignees stuck — same silent no-op class as labels (upstream #15)
    if (args.assignees && args.assignees.length > 0) {
      const missingAssignees = findMissingAssigneeIds(completeTask.assignees, args.assignees);
      if (missingAssignees.length > 0) {
        await rollbackTaskCreation(
          client,
          creationState,
          new Error(
            `Assignees were requested but not attached after create (missing user ids: ${missingAssignees.join(', ')})`,
          ),
        );
      }
    }

    const response = createTaskResponse(
      'create-task',
      'Task created successfully',
      { task: completeTask },
      {
        timestamp: new Date().toISOString(),
        projectId: args.projectId,
        labelsAdded: creationState.labelsAdded,
        assigneesAdded: creationState.assigneesAdded,
      },
      undefined, // verbosity (ignored - using standard AORP)
      undefined, // useOptimizedFormat (ignored - using standard AORP)
      undefined, // useAorp (ignored - always using AORP)
      undefined, // aorpConfig (using auto-generated)
      args.sessionId
    );

    logger.debug('Tasks tool response', {
      subcommand: 'create',
      taskId: completeTask.id,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        },
      ],
    };
  } catch (error) {
    // Re-throw MCPError instances without modification
    if (error instanceof MCPError) {
      throw error;
    }

    // Handle fetch/connection errors with helpful guidance
    if (error instanceof Error && (
      error.message.includes('fetch failed') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    )) {
      throw handleFetchError(error, 'create task');
    }

    // Use standardized error transformation for all other errors
    throw transformApiError(error, 'Failed to create task');
  }
}

/**
 * Adds labels to a task via addLabelsToTaskAdditive (individual endpoint).
 * Avoids updateTaskLabels / {label_ids} which silently clears labels (upstream #92).
 */
async function addLabelsToTask(client: VikunjaClient, taskId: number, labelIds: number[]): Promise<void> {
  try {
    // Shared helper: individual PUT /tasks/{id}/labels. currentLabelIds: [] skips read
    // after create. withRetry is safe on this fork (breaker.fire(operation)).
    await addLabelsToTaskAdditive(client, taskId, labelIds, { currentLabelIds: [] });
  } catch (labelError) {
    // Check if it's an auth error
    if (isAuthenticationError(labelError)) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `${AUTH_ERROR_MESSAGES.LABEL_CREATE} Task ID: ${taskId}`,
      );
    }
    throw labelError;
  }
}

/**
 * Adds assignees via the individual PUT endpoint (bulk {user_ids} is a silent no-op).
 */
async function addAssigneesToTask(client: VikunjaClient, taskId: number, assigneeIds: number[]): Promise<void> {
  try {
    // Newly created task has no assignees yet — skip the extra read.
    await addAssigneesToTaskAdditive(client, taskId, assigneeIds, { currentAssigneeIds: [] });
  } catch (assigneeError) {
    if (isAuthenticationError(assigneeError)) {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `${AUTH_ERROR_MESSAGES.ASSIGNEE_CREATE} (Retried ${RETRY_CONFIG.AUTH_ERRORS.maxRetries} times). Task ID: ${taskId}`,
      );
    }
    throw assigneeError;
  }
}

/**
 * Attempts to roll back a partially created task and throws enhanced error context
 */
async function rollbackTaskCreation(
  client: VikunjaClient,
  creationState: CreationState,
  originalError: unknown
): Promise<never> {
  // Attempt to clean up the partially created task
  let rollbackSucceeded = false;
  if (creationState.createdTask.id) {
    try {
      await client.tasks.deleteTask(creationState.createdTask.id);
      rollbackSucceeded = true;
    } catch (deleteError) {
      // Log the cleanup failure but throw the original error
      logger.error('Failed to clean up partially created task:', deleteError);
    }
  }

  // Re-throw the original error with context
  const errorMessage = `Failed to complete task creation: ${originalError instanceof Error ? originalError.message : String(originalError)}. ${
    rollbackSucceeded
      ? 'Task was successfully rolled back.'
      : 'Task rollback also failed - manual cleanup may be required.'
  }`;

  throw new MCPError(ErrorCode.API_ERROR, errorMessage, {
    vikunjaError: {
      taskId: creationState.createdTask.id,
      partiallyCreated: true,
      labelsAdded: creationState.labelsAdded,
      assigneesAdded: creationState.assigneesAdded,
      rollbackSucceeded,
    },
  });
}