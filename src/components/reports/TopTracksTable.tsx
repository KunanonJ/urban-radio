"use client";

import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TopTrackRow } from "@/lib/reports-queries";

export interface TopTracksTableProps {
  tracks?: TopTrackRow[];
  isLoading?: boolean;
  className?: string;
}

export function TopTracksTable({
  tracks,
  isLoading,
  className,
}: TopTracksTableProps) {
  const { t } = useTranslation();

  return (
    <Card data-testid="reports-top-tracks-card" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("reports.trends.topTracks")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div
            data-testid="reports-top-tracks-skeleton"
            className="space-y-2 p-4"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : !tracks || tracks.length === 0 ? (
          <p
            data-testid="reports-top-tracks-empty"
            className="py-12 text-center text-sm text-muted-foreground"
          >
            {t("reports.empty.title")}
          </p>
        ) : (
          <Table data-testid="reports-top-tracks-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead className="text-right">
                  {t("reports.overview.totalPlays")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tracks.map((row, i) => (
                <TableRow
                  key={`${row.title}|${row.artist}|${i}`}
                  data-testid={`reports-top-tracks-row-${i}`}
                >
                  <TableCell
                    data-testid={`reports-top-tracks-rank-${i}`}
                    className="font-medium text-muted-foreground"
                  >
                    {i + 1}
                  </TableCell>
                  <TableCell className="font-medium">{row.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.artist}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.plays.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default TopTracksTable;
