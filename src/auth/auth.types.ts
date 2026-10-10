import { UserRole } from '@prisma/client';

/** Payload embarqué dans l'access token. Volontairement minimal. */
export interface JwtPayload {
  /** "subject" — userId */
  sub: string;
  role: UserRole;
  /** jti — token ID unique pour la révocation si nécessaire */
  jti: string;
}

/** Objet attaché à `request.user` après validation du JWT. */
export interface RequestUser {
  userId: string;
  role: UserRole;
  jti: string;
}
