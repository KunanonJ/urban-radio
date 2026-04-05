'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROTATION_CATEGORIES } from '@/lib/utils/constants';
import type { Artist } from '@/types';

interface TrackFiltersProps {
  readonly artists: readonly Artist[];
  readonly artistId: string;
  readonly onArtistChange: (artistId: string) => void;
  readonly rotation: string;
  readonly onRotationChange: (rotation: string) => void;
  readonly status: string;
  readonly onStatusChange: (status: string) => void;
}

export function TrackFilters({
  artists,
  artistId,
  onArtistChange,
  rotation,
  onRotationChange,
  status,
  onStatusChange,
}: TrackFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={artistId} onValueChange={(val) => onArtistChange(val ?? 'all')}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All artists" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All artists</SelectItem>
          {artists.map((artist) => (
            <SelectItem key={artist.id} value={artist.id}>
              {artist.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={rotation} onValueChange={(val) => onRotationChange(val ?? 'all')}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All rotations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All rotations</SelectItem>
          {ROTATION_CATEGORIES.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(val) => onStatusChange(val ?? 'all')}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
