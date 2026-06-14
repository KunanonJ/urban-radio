"use client";

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReportOverview } from "@/lib/reports-queries";

export interface OverviewCardsProps {
  overview?: ReportOverview;
  isLoading?: boolean;
}

interface CardSpec {
  testid: string;
  i18nKey: string;
  value: number;
  decimals?: number;
}

/** Format a number with thousands separators, optional decimals. */
function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function OverviewCards({ overview, isLoading }: OverviewCardsProps) {
  const { t } = useTranslation();

  if (isLoading || !overview) {
    return (
      <div
        data-testid="reports-overview-skeleton"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const cards: CardSpec[] = [
    {
      testid: "reports-overview-total-plays",
      i18nKey: "reports.overview.totalPlays",
      value: overview.totalPlays,
    },
    {
      testid: "reports-overview-unique-titles",
      i18nKey: "reports.overview.uniqueTitles",
      value: overview.uniqueTitles,
    },
    {
      testid: "reports-overview-active-days",
      i18nKey: "reports.overview.daysWithActivity",
      value: overview.daysWithActivity,
    },
    {
      testid: "reports-overview-listening-hours",
      i18nKey: "reports.overview.totalListeningHours",
      value: overview.totalListeningHours,
      decimals: 1,
    },
  ];

  return (
    <div
      data-testid="reports-overview-cards"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {cards.map((c) => (
        <Card key={c.testid} data-testid={c.testid}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t(c.i18nKey)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums text-foreground">
              {fmt(c.value, c.decimals ?? 0)}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default OverviewCards;
