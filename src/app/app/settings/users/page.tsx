'use client';

import { useState, useCallback } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import { orderBy } from 'firebase/firestore';
import { Pencil } from 'lucide-react';
import type { AppUser, UserRole } from '@/types';

const ROLES: UserRole[] = ['admin', 'manager', 'librarian', 'traffic', 'operator', 'viewer'];

const ROLE_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  admin: 'destructive',
  manager: 'default',
  librarian: 'secondary',
  traffic: 'secondary',
  operator: 'outline',
  viewer: 'outline',
};

export default function UsersSettingsPage() {
  const { data: users = [], isLoading } = useFirestoreQuery<AppUser>({
    collectionPath: 'users',
    constraints: [orderBy('displayName', 'asc')],
    queryKey: ['users'],
  });

  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const handleSaveRole = useCallback(async () => {
    if (!editUser || !selectedRole) return;
    setSaving(true);
    try {
      // In production, this calls the setUserRole Cloud Function
      // const { getFunctions, httpsCallable } = await import('firebase/functions');
      // const functions = getFunctions();
      // const setUserRole = httpsCallable(functions, 'setUserRole');
      // await setUserRole({ uid: editUser.id, role: selectedRole });
      setEditUser(null);
    } finally {
      setSaving(false);
    }
  }, [editUser, selectedRole]);

  const columns: ColumnDef<AppUser, unknown>[] = [
    {
      accessorKey: 'displayName',
      header: 'Name',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.displayName ?? 'No name'}</span>
      ),
    },
    {
      accessorKey: 'email',
      header: 'Email',
    },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => (
        <Badge variant={ROLE_COLORS[row.original.role] ?? 'outline'}>
          {row.original.role}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setEditUser(row.original);
            setSelectedRole(row.original.role);
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="User Management" description="Manage station staff and roles" />
      <DataTable columns={columns} data={users} loading={isLoading} />

      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>User</Label>
              <p className="text-sm">{editUser?.displayName ?? editUser?.email}</p>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={(val) => { if (val) setSelectedRole(val); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditUser(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSaveRole} disabled={saving || selectedRole === editUser?.role}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
