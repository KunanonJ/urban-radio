"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart } from "@tremor/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TopHourBucket } from "@/lib/reports-queries";

export interface TopHoursChartProps {
  data?: TopHourBucket[];
  isLoading?: boolean;
  className?: string;
}

interface BarChartDatum {
  hour: string;
  plays: number;
}

function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** Zero-fill 24 buckets and ensure ordering by hour 0..23. */
function normaliseHours(data?: TopHourBucket[]): BarChartDatum[] {
  const map = new Map<number, number>();
  for (const row of data ?? []) {
    const h = Math.max(0, Math.min(23, Math.round(row.hour)));
    map.set(h, (map.get(h) ?? 0) + row.plays);
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: formatHourLabel(h),
    plays: map.get(h) ?? 0,
  }));
}

export function TopHoursChart({ data, isLoading, className }: TopHoursChartProps) {
  const { t } = useTranslation();
  const chartData = useMemo(() => normaliseHours(data), [data]);
  const totalPlays = useMemo(
    () => chartData.reduce((acc, d) => acc + d.plays, 0),
    [chartData],
  );

  return (
    <Card data-testid="reports-top-hours-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("reports.trends.topHours")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton
            data-testid="reports-top-hours-skeleton"
            className="h-48 w-full"
          />
        ) : totalPlays === 0 ? (
          <p
            data-testid="reports-top-hours-empty"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            {t("reports.empty.title")}
          </p>
        ) : (
          <div
            data-testid="reports-top-hours-chart"
            data-bars={chartData.length}
          >
            <BarChart
              className="h-48"
              data={chartData}
              index="hour"
              categories={["plays"]}
              colors={["violet"]}
              showLegend={false}
              showGridLines
              yAxisWidth={42}
              valueFormatter={(v: number) => v.toLocaleString()}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TopHoursChart;
