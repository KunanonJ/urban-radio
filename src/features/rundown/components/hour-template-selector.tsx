'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ClockTemplate } from '@/types';

interface HourTemplateSelectorProps {
  readonly hour: number;
  readonly selectedTemplateId: string | undefined;
  readonly templates: readonly ClockTemplate[];
  readonly onChange: (hour: number, templateId: string) => void;
}

export function HourTemplateSelector({
  hour,
  selectedTemplateId,
  templates,
  onChange,
}: HourTemplateSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-mono w-12">{String(hour).padStart(2, '0')}:00</span>
      <Select
        value={selectedTemplateId ?? ''}
        onValueChange={(val) => { if (val) onChange(hour, val); }}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select template" />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
