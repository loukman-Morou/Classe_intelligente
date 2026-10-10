import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pipe de validation UUID strict.
 *
 * Pourquoi ne pas utiliser ParseUUIDPipe de NestJS ?
 *  - ParseUUIDPipe expose le nom du paramètre dans le message d'erreur
 *    ("Validation failed (uuid v4 is expected)") — information utile pour le
 *    debugging mais potentiellement révélatrice de la structure interne.
 *  - Ce pipe retourne une erreur standard (`BAD_REQUEST`) sans détail sur le
 *    paramètre concerné, cohérent avec notre format d'erreur global.
 *
 * Protection : empêche l'injection d'identifiants non-UUID (ex: `../../etc/passwd`,
 * SQL fragments, très longues chaînes) dans les paramètres de route avant même
 * d'atteindre la DB. Prisma paramètre ses requêtes, donc le risque SQL est faible,
 * mais rejeter tôt réduit la surface d'attaque et évite des roundtrips DB inutiles.
 */
@Injectable()
export class StrictUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_V4_REGEX.test(value)) {
      throw new BadRequestException('Identifiant invalide.');
    }
    return value.toLowerCase();
  }
}
