/**
 * Project response formatter edge cases
 */

import { describe, it, expect } from '@jest/globals';
import {
  createBreadcrumbResponse,
  createProjectTreeResponse,
  createProjectListResponse,
} from '../../src/tools/projects/response-formatter';

describe('project response formatter', () => {
  it('handles empty breadcrumbs and list/tree edge cases', () => {
    expect(createBreadcrumbResponse([])).toBeDefined();
    expect(createProjectTreeResponse([{ id: 1, title: 'Root', children: [] }] as never, 1, 1)).toBeDefined();
    expect(createProjectTreeResponse([
      { id: 1, title: 'A', children: [] },
      { id: 2, title: 'B', children: [] },
    ] as never, 1, 2)).toBeDefined();
    expect(createProjectListResponse([{ id: 1, title: 'P' }] as never, 1, 1, 10)).toBeDefined();
    expect(createProjectListResponse([{ id: 1, title: 'P' }] as never, 1, 2, 1)).toBeDefined();
  });
});
