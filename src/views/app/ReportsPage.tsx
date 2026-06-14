"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";

import {
  DateRangePicker,
  type DateRangeValue,
  type RangePreset,
} from "@/components/reports/DateRangePicker";
import { OverviewCards } from "@/components/reports/OverviewCards";
import { PlaysByDayChart } from "@/components/reports/PlaysByDayChart";
import { TopHoursChart } from "@/components/reports/TopHoursChart";
import { TopTracksTable } from "@/components/reports/TopTracksTable";
import { RoyaltyExportPanel } from "@/components/reports/RoyaltyExportPanel";

import {
  useReportOverview,
  useReportPlaysByDay,
  useReportTopHours,
  useReportTopTracks,
} from "@/lib/reports-queries";

type TabKey = "overview" | "trends" | "geography" | "milestones" | "royalty";

const TABS: TabKey[] = [
  "overview",
  "trends",
  "geography",
  "milestones",
  "royalty",
];

const TAB_DEFAULT: TabKey = "overview";

export function ReportsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRangeValue | undefined>(undefined);
  const [tab, setTab] = useState<TabKey>(TAB_DEFAULT);

  const handleRangeChange = (next: DateRangeValue, _preset: RangePreset) => {
    setRange(next);
  };

  // All hooks share the same `range` so a date change refetches every tab.
  const overviewQ = useReportOverview(range ?? {});
  const playsByDayQ = useReportPlaysByDay(range ?? {});
  const topHoursQ = useReportTopHours(range ?? {});
  const topTracksQ = useReportTopTracks(range ?? {}, { limit: 25 });

  return (
    <div className="app-page space-y-4" data-testid="reports-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">
              {t("reports.title")}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("reports.subtitle")}
          </p>
        </div>
        <DateRangePicker onRangeChange={handleRangeChange} />
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        data-testid="reports-tabs"
      >
        <TabsList>
          {TABS.map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              data-testid={`reports-tab-${key}`}
            >
              {t(`reports.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value="overview"
          className="space-y-4"
          data-testid="reports-tab-content-overview"
        >
          <OverviewCards
            overview={overviewQ.data?.overview}
            isLoading={overviewQ.isLoading}
          />
          <PlaysByDayChart
            data={playsByDayQ.data?.days}
            isLoading={playsByDayQ.isLoading}
            compact
          />
        </TabsContent>

        <TabsContent
          value="trends"
          className="space-y-4"
          data-testid="reports-tab-content-trends"
        >
          <PlaysByDayChart
            data={playsByDayQ.data?.days}
            isLoading={playsByDayQ.isLoading}
          />
          <TopHoursChart
            data={topHoursQ.data?.hours}
            isLoading={topHoursQ.isLoading}
          />
          <TopTracksTable
            tracks={topTracksQ.data?.tracks}
            isLoading={topTracksQ.isLoading}
          />
        </TabsContent>

        <TabsContent
          value="geography"
          data-testid="reports-tab-content-geography"
        >
          <EmptyState
            title={t("reports.geography.title")}
            description={t("reports.geography.comingSoon")}
          />
        </TabsContent>

        <TabsContent
          value="milestones"
          data-testid="reports-tab-content-milestones"
        >
          <EmptyState
            title={t("reports.milestones.title")}
            description={t("reports.milestones.comingSoon")}
          />
        </TabsContent>

        <TabsContent
          value="royalty"
          data-testid="reports-tab-content-royalty"
        >
          <RoyaltyExportPanel from={range?.from} to={range?.to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ReportsPage;
