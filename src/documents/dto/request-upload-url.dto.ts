import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ProfessorDocumentType } from '@prisma/client';

export class RequestUploadUrlDto {
  /**
   * Nom original du fichier — conservé pour l'affichage uniquement.
   * Jamais utilisé pour construire le chemin de stockage (voir storageKey).
   */
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  contentType!: string;

  /** Taille déclarée en bytes — vérifiée contre les limites configurées. */
  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024) // 50 MB max absolu côté DTO (complété par config)
  size!: number;

  @IsEnum(ProfessorDocumentType)
  @IsOptional()
  documentType?: ProfessorDocumentType;

  /** Pour un corrigé (CORRECTION), ID de l'épreuve associée (EXAM). */
  @IsString()
  @IsOptional()
  examDocumentId?: string;

  /** Date à partir de laquelle le corrigé devient visible (CORRECTION uniquement). */
  @IsString()
  @IsOptional()
  correctionVisibleAt?: string;
}
