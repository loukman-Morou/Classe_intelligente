import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ProposalType } from '@prisma/client';

export class CreateUpdateProposalDto {
  /** ID de la ClassCourse cible (copie dans la classe). */
  @IsUUID('4')
  classCourseId!: string;

  @IsEnum(ProposalType)
  type!: ProposalType;

  /**
   * Contenu de la proposition.
   * Pour UPDATE : snapshot ou delta des modifications.
   * Pour CLARIFICATION : objet décrivant la clarification à ajouter.
   * Format libre JSON — la logique de merge est côté service.
   */
  @IsString()
  @MaxLength(10000)
  proposalContent!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}
