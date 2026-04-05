export interface SongSeparationRules {
  readonly sameArtistMinSlots: number;
  readonly sameTrackMinHours: number;
}

export interface AdRules {
  readonly defaultMinMinutesBetweenSameAdvertiser: number;
}

export interface Station {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly language: string;
  readonly explicitContentAllowed: boolean;
  readonly songSeparationRules: SongSeparationRules;
  readonly adRules: AdRules;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
