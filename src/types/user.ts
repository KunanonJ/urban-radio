export type UserRole = 'admin' | 'manager' | 'librarian' | 'traffic' | 'operator' | 'viewer';

export type UserStatus = 'active' | 'disabled';

export interface AppUser {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly stationId: string;
  readonly status: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserClaims {
  readonly role: UserRole;
  readonly stationId: string;
}
