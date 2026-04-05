import type { UserRole } from '@/types';

export type Permission =
  | 'library:read'
  | 'library:write'
  | 'ads:read'
  | 'ads:write'
  | 'ads:approve'
  | 'clock:read'
  | 'clock:write'
  | 'rundown:read'
  | 'rundown:write'
  | 'rundown:publish'
  | 'operator:read'
  | 'operator:mark_played'
  | 'reports:read'
  | 'reports:export'
  | 'settings:read'
  | 'settings:write'
  | 'users:manage';

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    'library:read', 'library:write',
    'ads:read', 'ads:write', 'ads:approve',
    'clock:read', 'clock:write',
    'rundown:read', 'rundown:write', 'rundown:publish',
    'operator:read', 'operator:mark_played',
    'reports:read', 'reports:export',
    'settings:read', 'settings:write',
    'users:manage',
  ],
  manager: [
    'library:read', 'library:write',
    'ads:read', 'ads:write', 'ads:approve',
    'clock:read', 'clock:write',
    'rundown:read', 'rundown:write', 'rundown:publish',
    'operator:read', 'operator:mark_played',
    'reports:read', 'reports:export',
    'settings:read',
  ],
  librarian: [
    'library:read', 'library:write',
    'ads:read',
    'clock:read',
    'rundown:read',
    'reports:read',
  ],
  traffic: [
    'library:read',
    'ads:read', 'ads:write',
    'clock:read', 'clock:write',
    'rundown:read', 'rundown:write',
    'reports:read', 'reports:export',
  ],
  operator: [
    'library:read',
    'rundown:read',
    'operator:read', 'operator:mark_played',
  ],
  viewer: [
    'library:read',
    'ads:read',
    'clock:read',
    'rundown:read',
    'reports:read',
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function getPermissions(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export type RouteAccess = {
  readonly path: string;
  readonly requiredPermission: Permission;
};

export const ROUTE_ACCESS: readonly RouteAccess[] = [
  { path: '/app/dashboard', requiredPermission: 'library:read' },
  { path: '/app/library', requiredPermission: 'library:read' },
  { path: '/app/ads', requiredPermission: 'ads:read' },
  { path: '/app/clock-templates', requiredPermission: 'clock:read' },
  { path: '/app/rundown', requiredPermission: 'rundown:read' },
  { path: '/app/operator', requiredPermission: 'operator:read' },
  { path: '/app/reports', requiredPermission: 'reports:read' },
  { path: '/app/settings/users', requiredPermission: 'users:manage' },
  { path: '/app/settings/station', requiredPermission: 'settings:read' },
];

export function canAccessRoute(role: UserRole, path: string): boolean {
  const route = ROUTE_ACCESS.find((r) => path.startsWith(r.path));
  if (!route) return true;
  return hasPermission(role, route.requiredPermission);
}
