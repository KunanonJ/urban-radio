import { describe, it, expect } from 'vitest';
import { hasPermission, canAccessRoute, getPermissions } from './roles';
import type { UserRole } from '@/types';

describe('hasPermission', () => {
  it('admin has all permissions', () => {
    expect(hasPermission('admin', 'library:read')).toBe(true);
    expect(hasPermission('admin', 'library:write')).toBe(true);
    expect(hasPermission('admin', 'users:manage')).toBe(true);
    expect(hasPermission('admin', 'rundown:publish')).toBe(true);
    expect(hasPermission('admin', 'ads:approve')).toBe(true);
  });

  it('manager has most permissions but not users:manage', () => {
    expect(hasPermission('manager', 'library:write')).toBe(true);
    expect(hasPermission('manager', 'rundown:publish')).toBe(true);
    expect(hasPermission('manager', 'users:manage')).toBe(false);
  });

  it('librarian can read/write library but not ads:write', () => {
    expect(hasPermission('librarian', 'library:read')).toBe(true);
    expect(hasPermission('librarian', 'library:write')).toBe(true);
    expect(hasPermission('librarian', 'ads:write')).toBe(false);
    expect(hasPermission('librarian', 'rundown:publish')).toBe(false);
  });

  it('traffic can manage ads and schedule but not library:write', () => {
    expect(hasPermission('traffic', 'ads:read')).toBe(true);
    expect(hasPermission('traffic', 'ads:write')).toBe(true);
    expect(hasPermission('traffic', 'rundown:write')).toBe(true);
    expect(hasPermission('traffic', 'library:write')).toBe(false);
  });

  it('operator can only read rundown and mark played', () => {
    expect(hasPermission('operator', 'operator:read')).toBe(true);
    expect(hasPermission('operator', 'operator:mark_played')).toBe(true);
    expect(hasPermission('operator', 'rundown:read')).toBe(true);
    expect(hasPermission('operator', 'library:write')).toBe(false);
    expect(hasPermission('operator', 'ads:write')).toBe(false);
    expect(hasPermission('operator', 'rundown:write')).toBe(false);
  });

  it('viewer has read-only access', () => {
    expect(hasPermission('viewer', 'library:read')).toBe(true);
    expect(hasPermission('viewer', 'ads:read')).toBe(true);
    expect(hasPermission('viewer', 'reports:read')).toBe(true);
    expect(hasPermission('viewer', 'library:write')).toBe(false);
    expect(hasPermission('viewer', 'ads:write')).toBe(false);
    expect(hasPermission('viewer', 'users:manage')).toBe(false);
  });
});

describe('canAccessRoute', () => {
  it('admin can access all routes', () => {
    expect(canAccessRoute('admin', '/app/dashboard')).toBe(true);
    expect(canAccessRoute('admin', '/app/library/tracks')).toBe(true);
    expect(canAccessRoute('admin', '/app/settings/users')).toBe(true);
  });

  it('operator can access operator and rundown routes', () => {
    expect(canAccessRoute('operator', '/app/operator')).toBe(true);
    expect(canAccessRoute('operator', '/app/rundown')).toBe(true);
  });

  it('operator cannot access settings/users', () => {
    expect(canAccessRoute('operator', '/app/settings/users')).toBe(false);
  });

  it('viewer cannot access settings/users', () => {
    expect(canAccessRoute('viewer', '/app/settings/users')).toBe(false);
  });

  it('traffic can access ads routes', () => {
    expect(canAccessRoute('traffic', '/app/ads/campaigns')).toBe(true);
    expect(canAccessRoute('traffic', '/app/ads/advertisers')).toBe(true);
  });
});

describe('getPermissions', () => {
  it('returns permissions array for a role', () => {
    const perms = getPermissions('viewer');
    expect(perms).toContain('library:read');
    expect(perms).not.toContain('library:write');
  });

  it('returns all permissions for admin', () => {
    const adminPerms = getPermissions('admin');
    const roles: UserRole[] = ['manager', 'librarian', 'traffic', 'operator', 'viewer'];
    for (const role of roles) {
      for (const perm of getPermissions(role)) {
        expect(adminPerms).toContain(perm);
      }
    }
  });
});
