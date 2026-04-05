'use client';

import { useState } from 'react';
import { Megaphone, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { CampaignTable } from '@/features/ads/components/campaign-table';
import { CampaignFormDialog } from '@/features/ads/components/campaign-form-dialog';
import {
  useCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
} from '@/features/ads/hooks/use-campaigns';
import { useAdvertisers } from '@/features/ads/hooks/use-advertisers';
import type { Campaign } from '@/types';
import type { CampaignFormValues } from '@/lib/validators/campaign.schema';
import { useDebounce } from '@/lib/hooks/use-debounce';

export default function CampaignsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: advertisers = [] } = useAdvertisers();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const remove = useDeleteCampaign();

  const filtered = debouncedSearch
    ? campaigns.filter((c) => c.campaignName.toLowerCase().includes(debouncedSearch.toLowerCase()))
    : campaigns;

  function handleCreate(values: CampaignFormValues) {
    create.mutate(values, {
      onSuccess: () => { toast.success('Campaign created'); setFormOpen(false); },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleUpdate(values: CampaignFormValues) {
    if (!editing) return;
    update.mutate({ id: editing.id, data: values }, {
      onSuccess: () => { toast.success('Campaign updated'); setEditing(null); },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleDelete() {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => { toast.success('Campaign deleted'); setDeleting(null); },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Manage ad campaigns"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Campaign
          </Button>
        }
      />

      {campaigns.length > 0 && (
        <div className="mb-4">
          <SearchInput placeholder="Search campaigns..." value={search} onChange={setSearch} />
        </div>
      )}

      {!isLoading && campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-12 w-12" />}
          title="No campaigns yet"
          description="Create your first campaign to manage ad spots."
          action={<Button onClick={() => setFormOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Campaign</Button>}
        />
      ) : (
        <CampaignTable
          campaigns={filtered}
          advertisers={advertisers}
          loading={isLoading}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      <CampaignFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        advertisers={advertisers}
        loading={create.isPending}
      />

      {editing && (
        <CampaignFormDialog
          open={!!editing}
          onOpenChange={(open) => { if (!open) setEditing(null); }}
          onSubmit={handleUpdate}
          campaign={editing}
          advertisers={advertisers}
          loading={update.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Delete Campaign"
        description={`Are you sure you want to delete "${deleting?.campaignName}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={remove.isPending}
      />
    </div>
  );
}
