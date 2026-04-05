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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { trackFormSchema, type TrackFormValues } from '@/lib/validators/track.schema';
import { ROTATION_CATEGORIES } from '@/lib/utils/constants';
import type { Track, Artist, Album } from '@/types';

interface TrackFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: TrackFormValues) => void;
  readonly track?: Track | null;
  readonly artists: readonly Artist[];
  readonly albums: readonly Album[];
  readonly loading?: boolean;
}

export function TrackFormDialog({
  open,
  onOpenChange,
  onSubmit,
  track,
  artists,
  albums,
  loading = false,
}: TrackFormDialogProps) {
  const form = useForm<TrackFormValues>({
    resolver: zodResolver(trackFormSchema) as Resolver<TrackFormValues>,
    defaultValues: {
      title: track?.title ?? '',
      artistId: track?.artistId ?? '',
      albumId: track?.albumId ?? null,
      genre: track?.genre ?? '',
      bpm: track?.bpm ?? null,
      durationSec: track?.durationSec ?? 0,
      isExplicit: track?.isExplicit ?? false,
      rotationCategory: track?.rotationCategory ?? 'C',
      energyLevel: track?.energyLevel ?? undefined,
      introSec: track?.introSec ?? undefined,
      outroSec: track?.outroSec ?? undefined,
      language: track?.language ?? '',
      releaseYear: track?.releaseYear ?? undefined,
      status: track?.status ?? 'draft',
    },
  });

  const selectedArtistId = form.watch('artistId');
  const filteredAlbums = selectedArtistId
    ? albums.filter((a) => a.artistId === selectedArtistId)
    : albums;

  function handleSubmit(values: TrackFormValues) {
    onSubmit(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{track ? 'Edit Track' : 'Add Track'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 px-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" placeholder="Track title" {...form.register('title')} />
                {form.formState.errors.title && (
                  <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="artistId">Artist</Label>
                <Select
                  value={form.watch('artistId')}
                  onValueChange={(val) => {
                    if (val) {
                      form.setValue('artistId', val);
                      form.setValue('albumId', null);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select artist" />
                  </SelectTrigger>
                  <SelectContent>
                    {artists.map((artist) => (
                      <SelectItem key={artist.id} value={artist.id}>
                        {artist.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.artistId && (
                  <p className="text-sm text-destructive">{form.formState.errors.artistId.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="albumId">Album</Label>
                <Select
                  value={form.watch('albumId') ?? ''}
                  onValueChange={(val) => form.setValue('albumId', val ?? null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No album" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No album</SelectItem>
                    {filteredAlbums.map((album) => (
                      <SelectItem key={album.id} value={album.id}>
                        {album.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="genre">Genre</Label>
                <Input id="genre" placeholder="Hip-Hop, R&B, Pop..." {...form.register('genre')} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="durationSec">Duration (sec)</Label>
                <Input
                  id="durationSec"
                  type="number"
                  placeholder="180"
                  {...form.register('durationSec')}
                />
                {form.formState.errors.durationSec && (
                  <p className="text-sm text-destructive">{form.formState.errors.durationSec.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bpm">BPM</Label>
                <Input id="bpm" type="number" placeholder="120" {...form.register('bpm')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rotationCategory">Rotation</Label>
                <Select
                  value={form.watch('rotationCategory')}
                  onValueChange={(val) => { if (val) form.setValue('rotationCategory', val as TrackFormValues['rotationCategory']); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROTATION_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="introSec">Intro (sec)</Label>
                <Input id="introSec" type="number" placeholder="0" {...form.register('introSec')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outroSec">Outro (sec)</Label>
                <Input id="outroSec" type="number" placeholder="0" {...form.register('outroSec')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="energyLevel">Energy (1-5)</Label>
                <Select
                  value={String(form.watch('energyLevel') ?? '')}
                  onValueChange={(val) => form.setValue('energyLevel', val ? (Number(val) as 1 | 2 | 3 | 4 | 5) : undefined) }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="language">Language</Label>
                <Input id="language" placeholder="English" {...form.register('language')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="releaseYear">Release Year</Label>
                <Input id="releaseYear" type="number" placeholder="2024" {...form.register('releaseYear')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.watch('status')}
                  onValueChange={(val) => { if (val) form.setValue('status', val as TrackFormValues['status']); }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.watch('isExplicit')}
                onCheckedChange={(checked) => form.setValue('isExplicit', checked)}
              />
              <Label>Explicit content</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : track ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
