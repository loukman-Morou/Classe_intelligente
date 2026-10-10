import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

/**
 * Toute la logique liée au hachage de mot de passe, isolée ici pour qu'aucun
 * autre service ne soit tenté de manipuler un mot de passe en clair ou un hash
 * autrement que via ces deux méthodes.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger('PasswordService');

  // Hash "leurre" utilisé quand l'email fourni au login n'existe pas, pour que
  // le temps de réponse soit le même que pour un mauvais mot de passe sur un
  // compte existant (défense contre l'énumération d'emails par timing attack —
  // voir AuthService.login()). Calculé une fois au démarrage, jamais persisté,
  // jamais utilisé pour authentifier qui que ce soit.
  private decoyHash = '';

  async onModuleInit(): Promise<void> {
    this.decoyHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });
  }

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, { type: argon2.argon2id });
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, plainPassword);
    } catch (error) {
      // argon2.verify lève si le hash est malformé plutôt que de renvoyer
      // `false` — on log côté serveur (signal potentiel de donnée corrompue)
      // mais on traite ça comme un échec d'authentification côté appelant,
      // jamais comme une erreur 500 qui bloquerait la réponse générique.
      this.logger.error('Hash de mot de passe illisible lors de la vérification', String(error));
      return false;
    }
  }

  /**
   * À appeler quand l'email n'existe pas, pour que le login prenne le même
   * temps CPU que s'il vérifiait un vrai mot de passe. Le résultat est toujours
   * `false` (le mot de passe fourni ne peut pas correspondre à ce hash aléatoire)
   * — seule la durée d'exécution compte ici.
   */
  async verifyAgainstDecoy(plainPassword: string): Promise<boolean> {
    return argon2.verify(this.decoyHash, plainPassword);
  }
}
