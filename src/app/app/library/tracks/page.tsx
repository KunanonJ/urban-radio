'use client';

import { useState, useMemo } from 'react';
import { Music, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { TrackTable } from '@/features/library/components/track-table';
import { TrackFormDialog } from '@/features/library/components/track-form-dialog';
import { TrackUploadDialog } from '@/features/library/components/track-upload-dialog';
import { TrackFilters } from '@/features/library/components/track-filters';
import {
  useTracks,
  useCreateTrack,
  useUpdateTrack,
  useDeleteTrack,
  normalizeTrackTitle,
} from '@/features/library/hooks/use-tracks';
import { useArtists } from '@/features/library/hooks/use-artists';
import { useAlbums } from '@/features/library/hooks/use-albums';
import { useAuth } from '@/lib/auth/context';
import { useDebounce } from '@/lib/hooks/use-debounce';
import type { Track, RotationCategory } from '@/types';
import type { TrackFormValues } from '@/lib/validators/track.schema';

export default function TracksPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [filterArtist, setFilterArtist] = useState('all');
  const [filterRotation, setFilterRotation] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [deletingTrack, setDeletingTrack] = useState<Track | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    storagePath: string;
    contentHash: string;
    durationSec: number;
  } | null>(null);

  const firestoreFilters = useMemo(() => {
    const f: { artistId?: string; rotationCategory?: RotationCategory; status?: string } = {};
    if (filterArtist !== 'all') f.artistId = filterArtist;
    if (filterRotation !== 'all') f.rotationCategory = filterRotation as RotationCategory;
    if (filterStatus !== 'all') f.status = filterStatus;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [filterArtist, filterRotation, filterStatus]);

  const { data: tracks = [], isLoading } = useTracks(firestoreFilters);
  const { data: artists = [] } = useArtists();
  const { data: albums = [] } = useAlbums();
  const createTrack = useCreateTrack();
  const updateTrack = useUpdateTrack();
  const deleteTrack = useDeleteTrack();

  const filteredTracks = debouncedSearch
    ? tracks.filter((t) =>
        t.title.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : tracks;

  function handleUploadComplete(storagePath: string, contentHash: string, durationSec: number) {
    setPendingUpload({ storagePath, contentHash, durationSec });
    setFormOpen(true);
  }

  function handleCreate(values: TrackFormValues) {
    if (!pendingUpload && !editingTrack) {
      toast.error('Please upload an audio file first');
      return;
    }
    createTrack.mutate(
      {
        ...values,
        normalizedTitle: normalizeTrackTitle(values.title),
        storagePath: pendingUpload?.storagePath ?? '',
        contentHash: pendingUpload?.contentHash ?? '',
        durationSec: pendingUpload?.durationSec ?? values.durationSec,
        createdBy: user?.uid ?? '',
      },
      {
        onSuccess: () => {
          toast.success('Track created');
          setFormOpen(false);
          setPendingUpload(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleUpdate(values: TrackFormValues) {
    if (!editingTrack) return;
    updateTrack.mutate(
      {
        id: editingTrack.id,
        data: { ...values, normalizedTitle: normalizeTrackTitle(values.title) },
      },
      {
        onSuccess: () => {
          toast.success('Track updated');
          setEditingTrack(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleDelete() {
    if (!deletingTrack) return;
    deleteTrack.mutate(deletingTrack.id, {
      onSuccess: () => {
        toast.success('Track deleted');
        setDeletingTrack(null);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Tracks"
        description="Manage your music library"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
            <Button onClick={() => { setPendingUpload(null); setFormOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Add Track
            </Button>
          </div>
        }
      />

      {tracks.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            placeholder="Search tracks..."
            value={search}
            onChange={setSearch}
          />
          <TrackFilters
            artists={artists}
            artistId={filterArtist}
            onArtistChange={setFilterArtist}
            rotation={filterRotation}
            onRotationChange={setFilterRotation}
            status={filterStatus}
            onStatusChange={setFilterStatus}
          />
        </div>
      )}

      {!isLoading && tracks.length === 0 ? (
        <EmptyState
          icon={<Music className="h-12 w-12" />}
          title="No tracks yet"
          description="Upload your first track to get started."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Track
            </Button>
          }
        />
      ) : (
        <TrackTable
          tracks={filteredTracks}
          artists={artists}
          loading={isLoading}
          onEdit={setEditingTrack}
          onDelete={setDeletingTrack}
        />
      )}

      <TrackUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploadComplete={handleUploadComplete}
      />

      <TrackFormDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setPendingUpload(null); } }}
        onSubmit={handleCreate}
        artists={artists}
        albums={albums}
        loading={createTrack.isPending}
      />

      {editingTrack && (
        <TrackFormDialog
          open={!!editingTrack}
          onOpenChange={(open) => { if (!open) setEditingTrack(null); }}
          onSubmit={handleUpdate}
          track={editingTrack}
          artists={artists}
          albums={albums}
          loading={updateTrack.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deletingTrack}
        onOpenChange={(open) => { if (!open) setDeletingTrack(null); }}
        title="Delete Track"
        description={`Are you sure you want to delete "${deletingTrack?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteTrack.isPending}
      />
    </div>
  );
}
