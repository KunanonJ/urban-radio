'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FulfillmentMeter } from '@/features/ads/components/fulfillment-meter';
import { SpotTable } from '@/features/ads/components/spot-table';
import { SpotUploadDialog } from '@/features/ads/components/spot-upload-dialog';
import { useCampaign } from '@/features/ads/hooks/use-campaigns';
import { useAdvertisers } from '@/features/ads/hooks/use-advertisers';
import {
  useSpots,
  useCreateSpot,
  useUpdateSpot,
  useDeleteSpot,
} from '@/features/ads/hooks/use-spots';
import type { Spot } from '@/types';
import { useState } from 'react';

interface CampaignDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = use(params);
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: advertisers = [] } = useAdvertisers();
  const { data: spots = [], isLoading: spotsLoading } = useSpots(id);
  const createSpot = useCreateSpot(id);
  const updateSpot = useUpdateSpot(id);
  const deleteSpotMutation = useDeleteSpot(id);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingSpot, setDeletingSpot] = useState<Spot | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!campaign) {
    notFound();
  }

  const advertiser = advertisers.find((a) => a.id === campaign.advertiserId);
  const approvedSpots = spots.filter((s) => s.approvalStatus === 'approved');
  // In v1, played count would come from play logs. For now, show 0.
  const playedCount = 0;

  function handleApprove(spot: Spot) {
    updateSpot.mutate({ id: spot.id, data: { approvalStatus: 'approved' } }, {
      onSuccess: () => toast.success('Spot approved'),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleReject(spot: Spot) {
    updateSpot.mutate({ id: spot.id, data: { approvalStatus: 'rejected' } }, {
      onSuccess: () => toast.success('Spot rejected'),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleDeleteSpot() {
    if (!deletingSpot) return;
    deleteSpotMutation.mutate(deletingSpot.id, {
      onSuccess: () => { toast.success('Spot deleted'); setDeletingSpot(null); },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/app/ads/campaigns">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to campaigns
          </Button>
        </Link>
      </div>

      <PageHeader
        title={campaign.campaignName}
        description={advertiser?.name ?? 'Unknown advertiser'}
        actions={
          <div className="flex items-center gap-2">
            <Badge>{campaign.status}</Badge>
            <Badge variant="outline">{campaign.priority}</Badge>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Date Range</p>
          <p className="text-sm font-medium">{campaign.startDate} — {campaign.endDate}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Approved Spots</p>
          <p className="text-sm font-medium">{approvedSpots.length} of {spots.length} total</p>
        </div>
        <div className="rounded-lg border p-4">
          <FulfillmentMeter
            label="Fulfillment"
            contracted={campaign.contractedSpots}
            played={playedCount}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pb-4">
        <h2 className="text-lg font-semibold">Spots</h2>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Upload Spot
        </Button>
      </div>

      <SpotTable
        spots={spots}
        loading={spotsLoading}
        onApprove={handleApprove}
        onReject={handleReject}
        onDelete={setDeletingSpot}
      />

      <SpotUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        campaignId={id}
        onSubmit={(values) => {
          createSpot.mutate(
            { ...values, campaignId: id },
            {
              onSuccess: () => { toast.success('Spot created'); setUploadOpen(false); },
              onError: (err) => toast.error(err.message),
            },
          );
        }}
        loading={createSpot.isPending}
      />

      <ConfirmDialog
        open={!!deletingSpot}
        onOpenChange={(open) => { if (!open) setDeletingSpot(null); }}
        title="Delete Spot"
        description={`Are you sure you want to delete "${deletingSpot?.title}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteSpot}
        loading={deleteSpotMutation.isPending}
      />
    </div>
  );
}
