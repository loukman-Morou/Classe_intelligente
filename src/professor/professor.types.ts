import { ProfessorDocumentType } from '@prisma/client';

/** Cours original dans l'espace professeur */
export interface ProfessorCourseContext {
  id: string; // ProfessorCourse.id
  courseId: string; // Course.id sous-jacent
  professorId: string;
  version: number;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Copie d'un cours dans une classe */
export interface ClassCourseContext {
  id: string; // ClassCourse.id
  classCourseId: string; // Course.id de la copie
  professorCourseId: string;
  classId: string;
  sharedAtVersion: number;
  syncStatus: string;
  status: string;
  sharedAt: Date;
}

/** Document dans l'espace professeur */
export interface ProfessorDocumentInfo {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  documentType: ProfessorDocumentType;
  status: string;
  correctionDocumentId: string | null;
  correctionVisibleAt: Date | null;
  createdAt: Date;
}
