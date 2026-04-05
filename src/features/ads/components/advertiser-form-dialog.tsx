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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { advertiserFormSchema, type AdvertiserFormValues } from '@/lib/validators/advertiser.schema';
import type { Advertiser } from '@/types';

interface AdvertiserFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: AdvertiserFormValues) => void;
  readonly advertiser?: Advertiser | null;
  readonly loading?: boolean;
}

export function AdvertiserFormDialog({
  open,
  onOpenChange,
  onSubmit,
  advertiser,
  loading = false,
}: AdvertiserFormDialogProps) {
  const form = useForm<AdvertiserFormValues>({
    resolver: zodResolver(advertiserFormSchema) as Resolver<AdvertiserFormValues>,
    defaultValues: {
      name: advertiser?.name ?? '',
      contactName: advertiser?.contactName ?? '',
      contactEmail: advertiser?.contactEmail ?? '',
      phone: advertiser?.phone ?? '',
      industry: advertiser?.industry ?? '',
      status: advertiser?.status ?? 'active',
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{advertiser ? 'Edit Advertiser' : 'Add Advertiser'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Company Name</Label>
            <Input id="name" placeholder="Acme Corp" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input id="contactName" placeholder="John Doe" {...form.register('contactName')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input id="contactEmail" type="email" placeholder="john@acme.com" {...form.register('contactEmail')} />
              {form.formState.errors.contactEmail && (
                <p className="text-sm text-destructive">{form.formState.errors.contactEmail.message}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" placeholder="+1 555-0100" {...form.register('phone')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" placeholder="Automotive, Retail..." {...form.register('industry')} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.watch('status')}
              onValueChange={(val) => { if (val) form.setValue('status', val as 'active' | 'inactive'); }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : advertiser ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
