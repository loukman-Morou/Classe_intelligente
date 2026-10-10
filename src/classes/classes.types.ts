import { ClassStatus } from '@prisma/client';

/**
 * Représentation allégée d'une classe une fois chargée depuis la DB,
 * avec les IDs de responsabilité pour les guards d'autorisation.
 */
export interface ClassContext {
  id: string;
  name: string;
  academicYear: string;
  description: string | null;
  status: ClassStatus;
  ownerId: string;
  coOwnerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
