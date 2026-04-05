'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode, type ComponentType } from 'react';
import { useAuth } from './context';
import type { UserRole } from '@/types';
import { hasPermission, type Permission } from './roles';
import { Skeleton } from '@/components/ui/skeleton';

interface RequireAuthProps {
  readonly children: ReactNode;
  readonly allowedRoles?: readonly UserRole[];
  readonly requiredPermission?: Permission;
  readonly fallback?: ReactNode;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="space-y-4 w-64">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export function RequireAuth({
  children,
  allowedRoles,
  requiredPermission,
  fallback,
}: RequireAuthProps) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!role) {
      router.replace('/unauthorized');
      return;
    }
    if (allowedRoles && !allowedRoles.includes(role)) {
      router.replace('/unauthorized');
      return;
    }
    if (requiredPermission && !hasPermission(role, requiredPermission)) {
      router.replace('/unauthorized');
    }
  }, [user, role, loading, allowedRoles, requiredPermission, router]);

  if (loading) return <LoadingScreen />;
  if (!user || !role) return null;
  if (allowedRoles && !allowedRoles.includes(role)) return null;
  if (requiredPermission && !hasPermission(role, requiredPermission)) return null;

  return <>{children}</>;
}

export function RequireRole({
  roles,
  permission,
  children,
  fallback = null,
}: {
  readonly roles?: readonly UserRole[];
  readonly permission?: Permission;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const { role } = useAuth();
  if (!role) return <>{fallback}</>;
  if (roles && !roles.includes(role)) return <>{fallback}</>;
  if (permission && !hasPermission(role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}

export function withAuth<P extends object>(
  Component: ComponentType<P>,
  allowedRoles?: readonly UserRole[],
) {
  function WrappedComponent(props: P) {
    return (
      <RequireAuth allowedRoles={allowedRoles}>
        <Component {...props} />
      </RequireAuth>
    );
  }
  WrappedComponent.displayName = `withAuth(${Component.displayName ?? Component.name ?? 'Component'})`;
  return WrappedComponent;
}
