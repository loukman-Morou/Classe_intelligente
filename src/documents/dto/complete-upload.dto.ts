import { IsBase64, IsEnum, IsOptional, IsString } from 'class-validator';
import { ProfessorDocumentType } from '@prisma/client';

export class CompleteUploadDto {
  /**
   * Les 16 premiers bytes du fichier, encodés en base64.
   * Le frontend les lit depuis le fichier localement AVANT de l'envoyer à S3,
   * et les transmet ici pour la vérification des magic bytes côté serveur.
   * Sans cela, le serveur ne reçoit jamais le fichier et ne peut pas vérifier
   * son contenu réel.
   */
  @IsString()
  @IsBase64()
  headerBytesBase64!: string;

  @IsEnum(ProfessorDocumentType)
  @IsOptional()
  documentType?: ProfessorDocumentType;

  /** Pour un corrigé (CORRECTION), ID de l'épreuve (EXAM) associée. */
  @IsString()
  @IsOptional()
  examDocumentId?: string;

  /** Date ISO à partir de laquelle le corrigé est visible (CORRECTION uniquement). */
  @IsString()
  @IsOptional()
  correctionVisibleAt?: string;
}
