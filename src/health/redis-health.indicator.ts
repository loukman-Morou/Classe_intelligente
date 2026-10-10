import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig } from '../config/configuration';

/**
 * Health indicator Redis : vérifie la connectivité au broker BullMQ.
 * Connexion créée à la demande et fermée après le check pour ne pas
 * maintenir une connexion permanente dédiée au health check.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger('RedisHealthIndicator');

  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const redisConfig = this.config.getOrThrow<RedisConfig>('redis');

    const client = new Redis(redisConfig.url, {
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await client.connect();
      await client.ping();
      return indicator.up();
    } catch {
      // Détail de l'erreur jamais exposé au client (topologie interne).
      this.logger.warn(`Redis health check failed`);
      return indicator.down({ reason: 'redis unreachable' });
    } finally {
      client.disconnect();
    }
  }
}
