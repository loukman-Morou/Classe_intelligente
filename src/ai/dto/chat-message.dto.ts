import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  /**
   * Si fourni, le message s'ajoute à la conversation existante.
   * Rechargé depuis la DB — jamais de confiance dans le contenu
   * d'une conversationId envoyée par le client pour contourner les accès.
   */
  @IsUUID('4')
  @IsOptional()
  conversationId?: string;

  /**
   * Mode anonyme : le professeur ne verra pas l'identité de cet étudiant
   * dans les statistiques et le radar pédagogique.
   * L'userId reste stocké en DB pour la sécurité/anti-abus/audit (docs/security.md §9).
   */
  @IsBoolean()
  @IsOptional()
  anonymous?: boolean;
}
