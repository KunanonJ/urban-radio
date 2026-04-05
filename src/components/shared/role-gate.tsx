'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth/context';
import { hasPermission, type Permission } from '@/lib/auth/roles';
import type { UserRole } from '@/types';

interface RoleGateProps {
  readonly roles?: readonly UserRole[];
  readonly permission?: Permission;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

export function RoleGate({
  roles,
  permission,
  children,
  fallback = null,
}: RoleGateProps) {
  const { role } = useAuth();

  if (!role) return <>{fallback}</>;
  if (roles && !roles.includes(role)) return <>{fallback}</>;
  if (permission && !hasPermission(role, permission)) return <>{fallback}</>;

  return <>{children}</>;
}
