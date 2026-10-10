import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      // Requête volontairement triviale : on vérifie la connectivité, pas une
      // logique métier. Jamais de requête sur une table contenant des données
      // utilisateur dans un health check.
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      // On ne renvoie jamais le détail de l'erreur DB au client du health
      // check (pourrait révéler la topologie interne) — juste "down".
      return indicator.down({ reason: 'database unreachable' });
    }
  }
}
