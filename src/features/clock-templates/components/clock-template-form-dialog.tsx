'use client';

import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  clockTemplateFormSchema,
  type ClockTemplateFormValues,
} from '@/lib/validators/clock-template.schema';
import type { ClockTemplate } from '@/types';

interface ClockTemplateFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: ClockTemplateFormValues) => void;
  readonly template?: ClockTemplate | null;
  readonly loading?: boolean;
}

export function ClockTemplateFormDialog({
  open,
  onOpenChange,
  onSubmit,
  template,
  loading = false,
}: ClockTemplateFormDialogProps) {
  const form = useForm<ClockTemplateFormValues>({
    resolver: zodResolver(clockTemplateFormSchema) as Resolver<ClockTemplateFormValues>,
    defaultValues: {
      name: template?.name ?? '',
      description: template?.description ?? '',
      daypart: template?.daypart ?? '',
      timezone: template?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit Template' : 'New Clock Template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Template Name</Label>
            <Input placeholder="Morning Drive" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Daypart</Label>
            <Input placeholder="e.g. Morning, Midday, Overnight" {...form.register('daypart')} />
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Input {...form.register('timezone')} />
            {form.formState.errors.timezone && (
              <p className="text-sm text-destructive">{form.formState.errors.timezone.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea placeholder="Optional description..." {...form.register('description')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : template ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
