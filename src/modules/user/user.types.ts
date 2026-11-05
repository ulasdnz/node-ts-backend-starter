import type { IUser } from './user.model.js';

// What the API may show of a user: never the password hash or the token version
export type UserResponse = Omit<IUser, 'password' | 'tokenVersion' | 'restore'>;

export interface AuthResponse {
  user: UserResponse;
  token: string;
  wasRestored: boolean;
}
