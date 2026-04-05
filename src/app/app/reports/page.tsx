'use client';

import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FulfillmentReport } from '@/features/reports/components/fulfillment-report';
import { PlayLogTable } from '@/features/reports/components/play-log-table';
import { useCampaigns } from '@/features/ads/hooks/use-campaigns';
import { useAdvertisers } from '@/features/ads/hooks/use-advertisers';
import { usePlayLogsByDateRange } from '@/features/operator/hooks/use-play-logs';
import { aggregateFulfillment } from '@/lib/utils/csv-export';
import { formatDateKey } from '@/lib/utils/format';

export default function ReportsPage() {
  const today = formatDateKey(new Date());
  const thirtyDaysAgo = formatDateKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const { data: campaigns = [], isLoading: loadingCampaigns } = useCampaigns();
  const { data: advertisers = [], isLoading: loadingAdvertisers } = useAdvertisers();
  const { data: playLogs = [], isLoading: loadingLogs } = usePlayLogsByDateRange(startDate, endDate);

  const advertiserMap = useMemo(
    () => new Map(advertisers.map((a) => [a.id, a.name])),
    [advertisers],
  );

  // Calculate fulfillment from play logs
  const campaignPlayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of playLogs) {
      if (log.itemType === 'ad') {
        // In a production system, we'd look up the campaign name from the spot
        // For now, we count by sourceRefId (spot ID)
        const key = log.sourceRefId ?? 'unknown';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [playLogs]);

  const fulfillmentData = useMemo(
    () => aggregateFulfillment(campaigns, advertiserMap, new Map(), campaignPlayCounts),
    [campaigns, advertiserMap, campaignPlayCounts],
  );

  return (
    <div>
      <PageHeader title="Reports" description="View operational reports and export data" />

      <div className="mb-6 flex items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Start Date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">End Date</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
        </div>
      </div>

      <Tabs defaultValue="fulfillment">
        <TabsList>
          <TabsTrigger value="fulfillment">Fulfillment</TabsTrigger>
          <TabsTrigger value="playlog">Play Log</TabsTrigger>
        </TabsList>
        <TabsContent value="fulfillment" className="mt-4">
          <FulfillmentReport
            data={fulfillmentData}
            loading={loadingCampaigns || loadingAdvertisers}
          />
        </TabsContent>
        <TabsContent value="playlog" className="mt-4">
          <PlayLogTable logs={playLogs} loading={loadingLogs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
