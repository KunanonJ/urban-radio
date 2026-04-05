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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { campaignFormSchema, type CampaignFormValues } from '@/lib/validators/campaign.schema';
import type { Campaign, Advertiser } from '@/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface CampaignFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: CampaignFormValues) => void;
  readonly campaign?: Campaign | null;
  readonly advertisers: readonly Advertiser[];
  readonly loading?: boolean;
}

export function CampaignFormDialog({
  open,
  onOpenChange,
  onSubmit,
  campaign,
  advertisers,
  loading = false,
}: CampaignFormDialogProps) {
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema) as Resolver<CampaignFormValues>,
    defaultValues: {
      advertiserId: campaign?.advertiserId ?? '',
      campaignName: campaign?.campaignName ?? '',
      startDate: campaign?.startDate ?? '',
      endDate: campaign?.endDate ?? '',
      contractedSpots: campaign?.contractedSpots ?? 1,
      priority: campaign?.priority ?? 'normal',
      allowedDays: campaign?.allowedDays ?? [0, 1, 2, 3, 4, 5, 6],
      allowedStartTime: campaign?.allowedStartTime ?? '',
      allowedEndTime: campaign?.allowedEndTime ?? '',
      maxPlaysPerHour: campaign?.maxPlaysPerHour ?? undefined,
      minMinutesBetweenRepeats: campaign?.minMinutesBetweenRepeats ?? undefined,
      status: campaign?.status ?? 'draft',
      notes: campaign?.notes ?? '',
    },
  });

  const allowedDays = form.watch('allowedDays') ?? [];

  function toggleDay(day: number) {
    const current = form.getValues('allowedDays');
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    form.setValue('allowedDays', next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign ? 'Edit Campaign' : 'New Campaign'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 px-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Campaign Name</Label>
                <Input placeholder="Summer Sale 2026" {...form.register('campaignName')} />
                {form.formState.errors.campaignName && (
                  <p className="text-sm text-destructive">{form.formState.errors.campaignName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Advertiser</Label>
                <Select
                  value={form.watch('advertiserId')}
                  onValueChange={(val) => { if (val) form.setValue('advertiserId', val); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select advertiser" />
                  </SelectTrigger>
                  <SelectContent>
                    {advertisers.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.advertiserId && (
                  <p className="text-sm text-destructive">{form.formState.errors.advertiserId.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" {...form.register('startDate')} />
                {form.formState.errors.startDate && (
                  <p className="text-sm text-destructive">{form.formState.errors.startDate.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" {...form.register('endDate')} />
                {form.formState.errors.endDate && (
                  <p className="text-sm text-destructive">{form.formState.errors.endDate.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Contracted Spots</Label>
                <Input type="number" min={1} {...form.register('contractedSpots')} />
                {form.formState.errors.contractedSpots && (
                  <p className="text-sm text-destructive">{form.formState.errors.contractedSpots.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.watch('priority')}
                  onValueChange={(val) => { if (val) form.setValue('priority', val as CampaignFormValues['priority']); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="guaranteed">Guaranteed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.watch('status')}
                  onValueChange={(val) => { if (val) form.setValue('status', val as CampaignFormValues['status']); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Allowed Days</Label>
              <div className="flex gap-3">
                {DAY_LABELS.map((label, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={allowedDays.includes(i)}
                      onCheckedChange={() => toggleDay(i)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {form.formState.errors.allowedDays && (
                <p className="text-sm text-destructive">{form.formState.errors.allowedDays.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Allowed Start Time</Label>
                <Input type="time" {...form.register('allowedStartTime')} />
              </div>
              <div className="space-y-2">
                <Label>Allowed End Time</Label>
                <Input type="time" {...form.register('allowedEndTime')} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Campaign notes..." {...form.register('notes')} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : campaign ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
