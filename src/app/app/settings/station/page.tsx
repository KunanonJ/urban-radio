'use client';

import { useEffect } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirestoreDoc } from '@/lib/hooks/use-firestore-query';
import { useFirestoreUpdate } from '@/lib/hooks/use-firestore-mutation';
import type { Station } from '@/types';

const stationSchema = z.object({
  name: z.string().min(1, 'Station name is required'),
  timezone: z.string().min(1, 'Timezone is required'),
  language: z.string().min(1),
  explicitContentAllowed: z.boolean(),
  sameArtistMinSlots: z.coerce.number().int().min(1).max(20),
  sameTrackMinHours: z.coerce.number().int().min(1).max(48),
  defaultMinMinutesBetweenSameAdvertiser: z.coerce.number().int().min(0).max(120),
});

type StationFormValues = z.infer<typeof stationSchema>;

export default function StationSettingsPage() {
  const { data: station, isLoading } = useFirestoreDoc<Station>({
    collectionPath: 'stations',
    docId: 'default',
    queryKey: ['stations', 'default'],
  });

  const updateMutation = useFirestoreUpdate<Partial<Station>>({
    collectionPath: 'stations',
    invalidateKeys: [['stations']],
  });

  const form = useForm<StationFormValues>({
    resolver: zodResolver(stationSchema) as Resolver<StationFormValues>,
    defaultValues: {
      name: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: 'en',
      explicitContentAllowed: false,
      sameArtistMinSlots: 4,
      sameTrackMinHours: 2,
      defaultMinMinutesBetweenSameAdvertiser: 30,
    },
  });

  useEffect(() => {
    if (station) {
      form.reset({
        name: station.name,
        timezone: station.timezone,
        language: station.language,
        explicitContentAllowed: station.explicitContentAllowed,
        sameArtistMinSlots: station.songSeparationRules.sameArtistMinSlots,
        sameTrackMinHours: station.songSeparationRules.sameTrackMinHours,
        defaultMinMinutesBetweenSameAdvertiser: station.adRules.defaultMinMinutesBetweenSameAdvertiser,
      });
    }
  }, [station, form]);

  function onSubmit(values: StationFormValues) {
    updateMutation.mutate({
      id: 'default',
      data: {
        name: values.name,
        timezone: values.timezone,
        language: values.language,
        explicitContentAllowed: values.explicitContentAllowed,
        songSeparationRules: {
          sameArtistMinSlots: values.sameArtistMinSlots,
          sameTrackMinHours: values.sameTrackMinHours,
        },
        adRules: {
          defaultMinMinutesBetweenSameAdvertiser: values.defaultMinMinutesBetweenSameAdvertiser,
        },
        updatedAt: new Date(),
      },
    });
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Station Settings" description="Configure station preferences" />
        <div className="animate-pulse space-y-4">
          <div className="h-48 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Station Settings" description="Configure station preferences" />
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Station Name</Label>
                <Input {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Input {...form.register('timezone')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Language</Label>
                <Input {...form.register('language')} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox
                  checked={form.watch('explicitContentAllowed')}
                  onCheckedChange={(checked) => form.setValue('explicitContentAllowed', !!checked)}
                />
                <Label>Allow Explicit Content</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Song Separation Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min Slots Between Same Artist</Label>
                <Input type="number" min={1} max={20} {...form.register('sameArtistMinSlots')} />
              </div>
              <div className="space-y-2">
                <Label>Min Hours Between Same Track</Label>
                <Input type="number" min={1} max={48} {...form.register('sameTrackMinHours')} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ad Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Min Minutes Between Same Advertiser</Label>
              <Input type="number" min={0} max={120} {...form.register('defaultMinMinutesBetweenSameAdvertiser')} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}
