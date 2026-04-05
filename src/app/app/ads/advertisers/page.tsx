'use client';

import { useState } from 'react';
import { Megaphone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { AdvertiserTable } from '@/features/ads/components/advertiser-table';
import { AdvertiserFormDialog } from '@/features/ads/components/advertiser-form-dialog';
import {
  useAdvertisers,
  useCreateAdvertiser,
  useUpdateAdvertiser,
  useDeleteAdvertiser,
} from '@/features/ads/hooks/use-advertisers';
import type { Advertiser } from '@/types';
import type { AdvertiserFormValues } from '@/lib/validators/advertiser.schema';
import { useDebounce } from '@/lib/hooks/use-debounce';

export default function AdvertisersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Advertiser | null>(null);
  const [deleting, setDeleting] = useState<Advertiser | null>(null);

  const { data: advertisers = [], isLoading } = useAdvertisers();
  const create = useCreateAdvertiser();
  const update = useUpdateAdvertiser();
  const remove = useDeleteAdvertiser();

  const filtered = debouncedSearch
    ? advertisers.filter((a) => a.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
    : advertisers;

  function handleCreate(values: AdvertiserFormValues) {
    create.mutate(values, {
      onSuccess: () => { toast.success('Advertiser created'); setFormOpen(false); },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleUpdate(values: AdvertiserFormValues) {
    if (!editing) return;
    update.mutate({ id: editing.id, data: values }, {
      onSuccess: () => { toast.success('Advertiser updated'); setEditing(null); },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleDelete() {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => { toast.success('Advertiser deleted'); setDeleting(null); },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Advertisers"
        description="Manage advertisers"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Advertiser
          </Button>
        }
      />

      {advertisers.length > 0 && (
        <div className="mb-4">
          <SearchInput placeholder="Search advertisers..." value={search} onChange={setSearch} />
        </div>
      )}

      {!isLoading && advertisers.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-12 w-12" />}
          title="No advertisers yet"
          description="Add your first advertiser to start managing campaigns."
          action={<Button onClick={() => setFormOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add Advertiser</Button>}
        />
      ) : (
        <AdvertiserTable advertisers={filtered} loading={isLoading} onEdit={setEditing} onDelete={setDeleting} />
      )}

      <AdvertiserFormDialog open={formOpen} onOpenChange={setFormOpen} onSubmit={handleCreate} loading={create.isPending} />

      {editing && (
        <AdvertiserFormDialog
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          onSubmit={handleUpdate}
          advertiser={editing}
          loading={update.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Delete Advertiser"
        description={`Are you sure you want to delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={remove.isPending}
      />
    </div>
  );
}
