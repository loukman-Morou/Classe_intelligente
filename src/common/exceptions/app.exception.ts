import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * À utiliser pour toute erreur métier qui doit exposer un `error.code` stable au
 * frontend (docs/api-contract.md §1 : "Le frontend doit utiliser error.code pour
 * gérer les erreurs"). AllExceptionsFilter lit ce code en priorité ; sans lui, il
 * retombe sur un code générique dérivé du statut HTTP (BAD_REQUEST, NOT_FOUND...).
 *
 * Ne jamais mettre dans `message` une information interne (SQL, chemin, stack) —
 * ce message est envoyé tel quel au client.
 */
export class AppException extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ code, message }, status);
  }
}
