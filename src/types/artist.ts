export type ArtistStatus = 'active' | 'archived';

export interface Artist {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly country?: string;
  readonly status: ArtistStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
