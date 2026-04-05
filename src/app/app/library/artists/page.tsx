'use client';

import { useState } from 'react';
import { Music, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { ArtistTable } from '@/features/library/components/artist-table';
import { ArtistFormDialog } from '@/features/library/components/artist-form-dialog';
import {
  useArtists,
  useCreateArtist,
  useUpdateArtist,
  useDeleteArtist,
  normalizeArtistName,
} from '@/features/library/hooks/use-artists';
import type { Artist } from '@/types';
import type { ArtistFormValues } from '@/lib/validators/artist.schema';
import { useDebounce } from '@/lib/hooks/use-debounce';

export default function ArtistsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editingArtist, setEditingArtist] = useState<Artist | null>(null);
  const [deletingArtist, setDeletingArtist] = useState<Artist | null>(null);

  const { data: artists = [], isLoading } = useArtists();
  const createArtist = useCreateArtist();
  const updateArtist = useUpdateArtist();
  const deleteArtist = useDeleteArtist();

  const filteredArtists = debouncedSearch
    ? artists.filter((a) =>
        a.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : artists;

  function handleCreate(values: ArtistFormValues) {
    createArtist.mutate(
      { ...values, normalizedName: normalizeArtistName(values.name) },
      {
        onSuccess: () => {
          toast.success('Artist created');
          setFormOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleUpdate(values: ArtistFormValues) {
    if (!editingArtist) return;
    updateArtist.mutate(
      {
        id: editingArtist.id,
        data: { ...values, normalizedName: normalizeArtistName(values.name) },
      },
      {
        onSuccess: () => {
          toast.success('Artist updated');
          setEditingArtist(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleDelete() {
    if (!deletingArtist) return;
    deleteArtist.mutate(deletingArtist.id, {
      onSuccess: () => {
        toast.success('Artist deleted');
        setDeletingArtist(null);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Artists"
        description="Manage artists in your library"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Artist
          </Button>
        }
      />

      {artists.length > 0 && (
        <div className="mb-4">
          <SearchInput
            placeholder="Search artists..."
            value={search}
            onChange={setSearch}
          />
        </div>
      )}

      {!isLoading && artists.length === 0 ? (
        <EmptyState
          icon={<Music className="h-12 w-12" />}
          title="No artists yet"
          description="Create your first artist to organize your library."
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Artist
            </Button>
          }
        />
      ) : (
        <ArtistTable
          artists={filteredArtists}
          loading={isLoading}
          onEdit={setEditingArtist}
          onDelete={setDeletingArtist}
        />
      )}

      <ArtistFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        loading={createArtist.isPending}
      />

      {editingArtist && (
        <ArtistFormDialog
          open={!!editingArtist}
          onOpenChange={(open) => { if (!open) setEditingArtist(null); }}
          onSubmit={handleUpdate}
          artist={editingArtist}
          loading={updateArtist.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deletingArtist}
        onOpenChange={(open) => { if (!open) setDeletingArtist(null); }}
        title="Delete Artist"
        description={`Are you sure you want to delete "${deletingArtist?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteArtist.isPending}
      />
    </div>
  );
}
