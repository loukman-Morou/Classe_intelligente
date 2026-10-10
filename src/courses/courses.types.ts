import { UserRole } from '@prisma/client';

/** Représentation d'un cours chargé depuis la DB, attachée à request.courseContext. */
export interface CourseContext {
  id: string;
  classId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Rôle du user courant vis-à-vis d'un cours donné.
 * Utilisé par le service pour les décisions d'autorisation fine après que
 * le guard a déjà validé l'accès minimal.
 */
export type CourseRole =
  | 'CLASS_OWNER'      // owner de la classe parente
  | 'CLASS_CO_OWNER'   // co-owner de la classe parente
  | 'COURSE_PROFESSOR' // professeur assigné à CE cours spécifiquement
  | 'STUDENT';         // étudiant membre de la classe

/** Contexte d'accès résolu par CourseAccessGuard et attaché à la requête. */
export interface CourseAccessContext {
  course: CourseContext;
  courseRole: CourseRole;
  userGlobalRole: UserRole;
}
