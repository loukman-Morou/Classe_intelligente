import { IsString, MinLength } from 'class-validator';

/**
 * Le refresh token voyage dans le corps de la requête, jamais dans l'URL/query
 * string (docs/security.md §2 : "ne jamais mettre de token sensible dans une
 * URL" — une URL finit dans des logs d'accès, un historique de navigateur, un
 * Referer header...).
 */
export class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
