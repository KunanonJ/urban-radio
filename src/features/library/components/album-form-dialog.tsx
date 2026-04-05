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
import { albumFormSchema, type AlbumFormValues } from '@/lib/validators/album.schema';
import type { Album, Artist } from '@/types';

interface AlbumFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: AlbumFormValues) => void;
  readonly album?: Album | null;
  readonly artists: readonly Artist[];
  readonly loading?: boolean;
}

export function AlbumFormDialog({
  open,
  onOpenChange,
  onSubmit,
  album,
  artists,
  loading = false,
}: AlbumFormDialogProps) {
  const form = useForm<AlbumFormValues>({
    resolver: zodResolver(albumFormSchema) as Resolver<AlbumFormValues>,
    defaultValues: {
      title: album?.title ?? '',
      artistId: album?.artistId ?? '',
      releaseYear: album?.releaseYear ?? undefined,
      status: album?.status ?? 'active',
    },
  });

  function handleSubmit(values: AlbumFormValues) {
    onSubmit(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{album ? 'Edit Album' : 'Add Album'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Album title"
              {...form.register('title')}
            />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="artistId">Artist</Label>
            <Select
              value={form.watch('artistId')}
              onValueChange={(val) => { if (val) form.setValue('artistId', val); }}
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
              <p className="text-sm text-destructive">
                {form.formState.errors.artistId.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="releaseYear">Release Year</Label>
            <Input
              id="releaseYear"
              type="number"
              placeholder="2024"
              {...form.register('releaseYear')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={form.watch('status')}
              onValueChange={(val) => { if (val) form.setValue('status', val as 'active' | 'archived'); }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
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
              {loading ? 'Saving...' : album ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
