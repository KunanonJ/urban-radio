'use client';

import Link from 'next/link';
import { Clock, Copy, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { DurationBar } from './duration-bar';
import { totalSegmentDuration, validateHourDuration } from '@/lib/validators/clock-template.schema';
import type { ClockTemplate } from '@/types';

interface TemplateCardProps {
  readonly template: ClockTemplate;
  readonly onEdit: (template: ClockTemplate) => void;
  readonly onDelete: (template: ClockTemplate) => void;
  readonly onClone: (template: ClockTemplate) => void;
}

export function TemplateCard({ template, onEdit, onDelete, onClone }: TemplateCardProps) {
  const total = totalSegmentDuration(template.segments);
  const validation = validateHourDuration(total);

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <Link href={`/app/clock-templates/${template.id}`} className="hover:underline">
            <CardTitle className="text-base">{template.name}</CardTitle>
          </Link>
          {template.daypart && (
            <Badge variant="secondary">{template.daypart}</Badge>
          )}
        </div>
        {template.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>{template.segments.length} segments</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{Math.floor(total / 60)}m {total % 60}s</span>
          {validation && (
            <Badge variant={validation.level === 'error' ? 'destructive' : 'outline'} className="ml-auto text-xs">
              {validation.level === 'error' ? 'Overflow' : 'Short'}
            </Badge>
          )}
        </div>
        <DurationBar segments={template.segments} />
      </CardContent>
      <CardFooter className="gap-1 border-t pt-3">
        <Link href={`/app/clock-templates/${template.id}`} className="flex-1">
          <Button variant="ghost" size="sm" className="w-full">
            <Pencil className="mr-1 h-3 w-3" /> Edit Segments
          </Button>
        </Link>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(template)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onClone(template)}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(template)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}
