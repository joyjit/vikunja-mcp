/**
 * Behavioral tests for TaskFilteringOrchestrator
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { SimpleFilterStorage } from '../../src/storage';
import type { TaskFilterExecutionResult } from '../../src/tools/tasks/types/filters';
import { MCPError, ErrorCode } from '../../src/types';

jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn().mockReturnValue({
    tasks: {
      list: jest.fn().mockResolvedValue({ results: [] }),
      getProjectTasks: jest.fn().mockResolvedValue({ results: [] }),
    },
  }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockValidateTaskFiltering = jest.fn();
const mockValidateLoadedTasks = jest.fn();
const mockPrepareQueryParameters = jest.fn();
const mockExecuteFiltering = jest.fn();

jest.mock('../../src/tools/tasks/filtering/FilterValidator', () => ({
  FilterValidator: {
    validateTaskFiltering: (...args: unknown[]) => mockValidateTaskFiltering(...args),
    validateLoadedTasks: (...args: unknown[]) => mockValidateLoadedTasks(...args),
  },
}));

jest.mock('../../src/tools/tasks/filtering/FilterExecutor', () => ({
  FilterExecutor: {
    prepareQueryParameters: (...args: unknown[]) => mockPrepareQueryParameters(...args),
    executeFiltering: (...args: unknown[]) => mockExecuteFiltering(...args),
  },
}));

import { TaskFilteringOrchestrator } from '../../src/tools/tasks/filtering/TaskFilteringOrchestrator';

const mockStorage = {} as SimpleFilterStorage;

const baseArgs = {
  filter: 'done = false',
  filterId: undefined,
  projectId: 1,
  page: 1,
  perPage: 50,
  search: 'todo',
  sort: 'priority',
};

const baseResult: TaskFilterExecutionResult = {
  tasks: [{ id: 1 } as TaskFilterExecutionResult['tasks'][number]],
  metadata: {
    serverSideFilteringUsed: false,
    serverSideFilteringAttempted: true,
    clientSideFiltering: true,
    filteringNote: 'fallback',
  },
  memoryInfo: {
    actualCount: 1,
    maxAllowed: 100,
    estimatedMemoryMB: 1,
  },
};

describe('TaskFilteringOrchestrator behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateTaskFiltering.mockResolvedValue({
      filterExpression: null,
      filterString: 'done = false',
      validationWarnings: ['warn-1'],
      memoryValidation: { isValid: true, warnings: [] },
    });
    mockPrepareQueryParameters.mockReturnValue({ page: 1 });
    mockExecuteFiltering.mockResolvedValue(baseResult);
    mockValidateLoadedTasks.mockReturnValue({ warnings: [], shouldThrow: false });
  });

  it('executes the filtering workflow and surfaces validation warnings', async () => {
    const result = await TaskFilteringOrchestrator.executeTaskFiltering(baseArgs, mockStorage);
    expect(result.tasks).toHaveLength(1);
    expect(mockValidateTaskFiltering).toHaveBeenCalled();
    expect(mockExecuteFiltering).toHaveBeenCalled();
  });

  it('throws when loaded-task validation fails', async () => {
    mockValidateLoadedTasks.mockReturnValue({
      warnings: ['too many'],
      shouldThrow: true,
    });

    await expect(
      TaskFilteringOrchestrator.executeTaskFiltering(baseArgs, mockStorage),
    ).rejects.toBeInstanceOf(MCPError);
  });

  it('re-throws MCPError from validation and wraps other errors', async () => {
    mockValidateTaskFiltering.mockRejectedValueOnce(
      new MCPError(ErrorCode.VALIDATION_ERROR, 'bad filter'),
    );
    await expect(
      TaskFilteringOrchestrator.executeTaskFiltering(baseArgs, mockStorage),
    ).rejects.toThrow('bad filter');

    mockValidateTaskFiltering.mockRejectedValueOnce(new Error('boom'));
    await expect(
      TaskFilteringOrchestrator.executeTaskFiltering(baseArgs, mockStorage),
    ).rejects.toThrow('boom');
  });

  it('validateTaskFiltering returns success, MCP errors, and generic errors', async () => {
    await expect(
      TaskFilteringOrchestrator.validateTaskFiltering(baseArgs, mockStorage),
    ).resolves.toMatchObject({ isValid: true, warnings: ['warn-1'], errors: [] });

    mockValidateTaskFiltering.mockRejectedValueOnce(
      new MCPError(ErrorCode.VALIDATION_ERROR, 'nope'),
    );
    await expect(
      TaskFilteringOrchestrator.validateTaskFiltering(baseArgs, mockStorage),
    ).resolves.toMatchObject({ isValid: false, errors: ['nope'] });

    mockValidateTaskFiltering.mockRejectedValueOnce('string-fail');
    await expect(
      TaskFilteringOrchestrator.validateTaskFiltering(baseArgs, mockStorage),
    ).resolves.toMatchObject({
      isValid: false,
      errors: ['Validation failed: string-fail'],
    });
  });

  it('createFilteringContext includes optional fields when present', () => {
    const ctx = TaskFilteringOrchestrator.createFilteringContext(baseArgs, baseResult);
    expect(ctx.input).toMatchObject({
      hasFilter: true,
      projectId: 1,
      page: 1,
      perPage: 50,
      search: 'todo',
      sort: 'priority',
    });
    expect(ctx.output.memoryInfo).toEqual(baseResult.memoryInfo);
    expect(ctx.performance.timestamp).toBeDefined();
  });

  it('createFilteringContext handles sparse args and missing metadata', () => {
    const sparseResult = {
      tasks: undefined,
      metadata: undefined,
    } as unknown as TaskFilterExecutionResult;

    const ctx = TaskFilteringOrchestrator.createFilteringContext({}, sparseResult);
    expect(ctx.input.hasFilter).toBe(false);
    expect(ctx.output).toMatchObject({
      taskCount: 0,
      serverSideFilteringUsed: false,
      filteringNote: '',
    });
    expect(ctx.output.memoryInfo).toBeUndefined();
  });

  it('analyzeFilteringPerformance reports issues and recommendations', () => {
    const suboptimal = TaskFilteringOrchestrator.analyzeFilteringPerformance(
      { filter: 'done = false', perPage: 1000, search: 'ab' },
      {
        ...baseResult,
        memoryInfo: { actualCount: 200, maxAllowed: 50, estimatedMemoryMB: 10 },
      },
    );
    expect(suboptimal.isOptimal).toBe(false);
    expect(suboptimal.issues.length).toBeGreaterThan(0);
    expect(suboptimal.recommendations.length).toBeGreaterThan(0);

    const neverAttempted = TaskFilteringOrchestrator.analyzeFilteringPerformance(
      { filter: 'done = false' },
      {
        tasks: [],
        metadata: {
          serverSideFilteringUsed: false,
          serverSideFilteringAttempted: false,
          clientSideFiltering: true,
          filteringNote: '',
        },
      },
    );
    expect(neverAttempted.recommendations.some((r) => r.includes('server-side'))).toBe(true);

    const optimal = TaskFilteringOrchestrator.analyzeFilteringPerformance(
      { perPage: 50, search: 'todo' },
      {
        tasks: [],
        metadata: {
          serverSideFilteringUsed: true,
          serverSideFilteringAttempted: true,
          clientSideFiltering: false,
          filteringNote: '',
        },
      },
    );
    expect(optimal.isOptimal).toBe(true);
  });
});
