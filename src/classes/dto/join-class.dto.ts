import { IsString, Length } from 'class-validator';

/**
 * Code court généré par le système lors de la création de la classe.
 * Phase 3 : code alphanumérique 8 caractères, suffisant pour une classe.
 * Les invitations sécurisées par lien (professeurs) arrivent en Phase 5.
 */
export class JoinClassDto {
  @IsString()
  @Length(8, 8)
  joinCode!: string;
}
