import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Point d'accès unique à Prisma pour toute l'application. Les modules métier ne
 * doivent jamais instancier leur propre PrismaClient : ils injectent ce service.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('Prisma');

  constructor() {
    // Le niveau "query" n'est volontairement pas activé par défaut : les
    // requêtes peuvent contenir des données utilisateur. À activer seulement
    // en debug local ciblé, jamais en production (voir docs/security.md §Logs).
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion PostgreSQL établie.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Permet à Nest de fermer proprement les connexions DB avant l'arrêt du
   * process (ex: SIGTERM en conteneur), évitant des connexions orphelines.
   */
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
