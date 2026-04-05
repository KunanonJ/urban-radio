export type AlbumStatus = 'active' | 'archived';

export interface Album {
  readonly id: string;
  readonly title: string;
  readonly artistId: string;
  readonly releaseYear?: number;
  readonly artworkPath?: string;
  readonly status: AlbumStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
