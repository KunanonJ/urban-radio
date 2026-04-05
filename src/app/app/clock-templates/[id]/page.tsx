'use client';

import { use, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SegmentEditor } from '@/features/clock-templates/components/segment-editor';
import {
  useClockTemplate,
  useUpdateClockTemplate,
} from '@/features/clock-templates/hooks/use-clock-templates';
import {
  totalSegmentDuration,
  validateHourDuration,
} from '@/lib/validators/clock-template.schema';
import type { ClockSegment } from '@/types';

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default function ClockTemplateDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: template, isLoading } = useClockTemplate(id);
  const updateMutation = useUpdateClockTemplate();

  const [pendingSegments, setPendingSegments] = useState<ClockSegment[] | null>(null);
  const isDirty = pendingSegments !== null;

  const currentSegments = pendingSegments ?? template?.segments ?? [];
  const total = totalSegmentDuration(currentSegments);
  const validation = validateHourDuration(total);
  const hasBlockingError = validation?.level === 'error';

  const handleSave = useCallback(() => {
    if (!template || !pendingSegments) return;
    updateMutation.mutate(
      { id: template.id, data: { segments: pendingSegments, updatedAt: new Date() } },
      {
        onSuccess: () => {
          setPendingSegments(null);
        },
      },
    );
  }, [template, pendingSegments, updateMutation]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="space-y-4">
        <PageHeader title="Template Not Found" />
        <p className="text-muted-foreground">This clock template does not exist.</p>
        <Link href="/app/clock-templates">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Templates
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/app/clock-templates">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{template.name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {template.daypart && <Badge variant="secondary">{template.daypart}</Badge>}
              <span>{currentSegments.length} segments</span>
              <span className="text-muted-foreground/50">|</span>
              <span>{Math.floor(total / 60)}m {total % 60}s / 60m</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Badge variant="outline" className="text-amber-500">Unsaved changes</Badge>
          )}
          <Button
            onClick={handleSave}
            disabled={!isDirty || hasBlockingError || updateMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <SegmentEditor
        segments={currentSegments}
        onChange={setPendingSegments}
      />
    </div>
  );
}
