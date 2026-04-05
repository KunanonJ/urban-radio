export type RotationCategory = 'A' | 'B' | 'C' | 'RECURRENT' | 'GOLD' | 'INACTIVE';

export type EnergyLevel = 1 | 2 | 3 | 4 | 5;

export type TrackStatus = 'draft' | 'active' | 'archived';

export interface Track {
  readonly id: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly artistId: string;
  readonly albumId?: string | null;
  readonly genre?: string;
  readonly subgenre?: string;
  readonly mood?: string;
  readonly language?: string;
  readonly bpm?: number | null;
  readonly musicalKey?: string | null;
  readonly durationSec: number;
  readonly isExplicit: boolean;
  readonly rotationCategory: RotationCategory;
  readonly energyLevel?: EnergyLevel;
  readonly introSec?: number;
  readonly outroSec?: number;
  readonly hookSec?: number;
  readonly storagePath: string;
  readonly artworkPath?: string;
  readonly contentHash: string;
  readonly status: TrackStatus;
  readonly releaseYear?: number;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
