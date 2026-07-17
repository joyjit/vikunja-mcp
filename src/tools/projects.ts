/**
 * Projects tool public surface — re-exports implementation modules.
 */

export { registerProjectsTool } from './projects/index';

export {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  type ListProjectsArgs,
  type GetProjectArgs,
  type CreateProjectArgs,
  type UpdateProjectArgs,
  type DeleteProjectArgs,
  type ArchiveProjectArgs,
} from './projects/crud';

export {
  getProjectChildren,
  getProjectTree,
  getProjectBreadcrumb,
  moveProject,
  type GetChildrenArgs,
  type GetTreeArgs,
  type GetBreadcrumbArgs,
  type MoveProjectArgs,
} from './projects/hierarchy';

export {
  createProjectShare,
  listProjectShares,
  getProjectShare,
  deleteProjectShare,
  authProjectShare,
  type CreateShareArgs,
  type ListSharesArgs,
  type GetShareArgs,
  type DeleteShareArgs,
  type AuthShareArgs,
} from './projects/sharing';

export {
  validateId,
  validateHexColor,
  validateProjectData,
  calculateProjectDepth,
  getMaxSubtreeDepth,
  validateMoveConstraints,
  MAX_PROJECT_DEPTH,
} from './projects/validation';

export {
  createProjectResponse,
  createProjectSuccessResponse,
  createProjectListResponse,
  createProjectTreeResponse,
  createBreadcrumbResponse,
} from './projects/response-formatter';
