"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AreaChart } from "@tremor/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlaysByDayBucket } from "@/lib/reports-queries";

export interface PlaysByDayChartProps {
  data?: PlaysByDayBucket[];
  isLoading?: boolean;
  /** When `compact`, height is reduced for sidebar/overview placement. */
  compact?: boolean;
  className?: string;
}

interface AreaChartDatum {
  day: string;
  plays: number;
}

function formatDayLabel(day: string): string {
  // Inputs from backend look like "2026-04-30". Show "Apr 30" for compactness.
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  const month = Number(parts[1]);
  const dayNum = Number(parts[2]);
  if (!month || !dayNum) return day;
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[month - 1]} ${dayNum}`;
}

export function PlaysByDayChart({
  data,
  isLoading,
  compact = false,
  className,
}: PlaysByDayChartProps) {
  const { t } = useTranslation();

  const chartData: AreaChartDatum[] = useMemo(
    () =>
      (data ?? []).map((row) => ({
        day: formatDayLabel(row.day),
        plays: row.plays,
      })),
    [data],
  );

  const totalPlays = useMemo(
    () => chartData.reduce((acc, d) => acc + d.plays, 0),
    [chartData],
  );

  return (
    <Card data-testid="reports-plays-by-day-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("reports.trends.playsByDay")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton
            data-testid="reports-plays-by-day-skeleton"
            className={compact ? "h-32 w-full" : "h-64 w-full"}
          />
        ) : chartData.length === 0 || totalPlays === 0 ? (
          <p
            data-testid="reports-plays-by-day-empty"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            {t("reports.empty.title")}
          </p>
        ) : (
          <div
            data-testid="reports-plays-by-day-chart"
            data-points={chartData.length}
          >
            <AreaChart
              className={compact ? "h-32" : "h-64"}
              data={chartData}
              index="day"
              categories={["plays"]}
              colors={["blue"]}
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

export default PlaysByDayChart;
