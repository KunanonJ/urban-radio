'use client';

import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DateNavigatorProps {
  readonly date: string;
  readonly onChange: (date: string) => void;
}

export function DateNavigator({ date, onChange }: DateNavigatorProps) {
  function shiftDay(delta: number) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    onChange(d.toISOString().split('T')[0]!);
  }

  const isToday = date === new Date().toISOString().split('T')[0];

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => shiftDay(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Input
          type="date"
          value={date}
          onChange={(e) => onChange(e.target.value)}
          className="w-[160px]"
        />
      </div>
      <Button variant="ghost" size="icon" onClick={() => shiftDay(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      {!isToday && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(new Date().toISOString().split('T')[0]!)}
        >
          Today
        </Button>
      )}
    </div>
  );
}
