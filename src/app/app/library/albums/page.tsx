'use client';

import { useState } from 'react';
import { Disc, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { AlbumTable } from '@/features/library/components/album-table';
import { AlbumFormDialog } from '@/features/library/components/album-form-dialog';
import {
  useAlbums,
  useCreateAlbum,
  useUpdateAlbum,
  useDeleteAlbum,
} from '@/features/library/hooks/use-albums';
import { useArtists } from '@/features/library/hooks/use-artists';
import type { Album } from '@/types';
import type { AlbumFormValues } from '@/lib/validators/album.schema';
import { useDebounce } from '@/lib/hooks/use-debounce';

export default function AlbumsPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<Album | null>(null);

  const { data: albums = [], isLoading } = useAlbums();
  const { data: artists = [] } = useArtists();
  const createAlbum = useCreateAlbum();
  const updateAlbum = useUpdateAlbum();
  const deleteAlbum = useDeleteAlbum();

  const filteredAlbums = debouncedSearch
    ? albums.filter((a) =>
        a.title.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : albums;

  function handleCreate(values: AlbumFormValues) {
    createAlbum.mutate(values, {
      onSuccess: () => {
        toast.success('Album created');
        setFormOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleUpdate(values: AlbumFormValues) {
    if (!editingAlbum) return;
    updateAlbum.mutate(
      { id: editingAlbum.id, data: values },
      {
        onSuccess: () => {
          toast.success('Album updated');
          setEditingAlbum(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleDelete() {
    if (!deletingAlbum) return;
    deleteAlbum.mutate(deletingAlbum.id, {
      onSuccess: () => {
        toast.success('Album deleted');
        setDeletingAlbum(null);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div>
      <PageHeader
        title="Albums"
        description="Manage albums in your library"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Album
          </Button>
        }
      />

      {albums.length > 0 && (
        <div className="mb-4">
          <SearchInput
            placeholder="Search albums..."
            value={search}
            onChange={setSearch}
          />
        </div>
      )}

      {!isLoading && albums.length === 0 ? (
        <EmptyState
          icon={<Disc className="h-12 w-12" />}
          title="No albums yet"
          description="Create your first album to organize tracks."
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Album
            </Button>
          }
        />
      ) : (
        <AlbumTable
          albums={filteredAlbums}
          artists={artists}
          loading={isLoading}
          onEdit={setEditingAlbum}
          onDelete={setDeletingAlbum}
        />
      )}

      <AlbumFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        artists={artists}
        loading={createAlbum.isPending}
      />

      {editingAlbum && (
        <AlbumFormDialog
          open={!!editingAlbum}
          onOpenChange={(open) => { if (!open) setEditingAlbum(null); }}
          onSubmit={handleUpdate}
          album={editingAlbum}
          artists={artists}
          loading={updateAlbum.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deletingAlbum}
        onOpenChange={(open) => { if (!open) setDeletingAlbum(null); }}
        title="Delete Album"
        description={`Are you sure you want to delete "${deletingAlbum?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteAlbum.isPending}
      />
    </div>
  );
}
