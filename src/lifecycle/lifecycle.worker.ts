import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { LifecycleService } from './lifecycle.service';
import { LifecycleConfig } from '../config/configuration';

export const LIFECYCLE_QUEUE = 'lifecycle';
export const LIFECYCLE_JOB   = 'lifecycle:run';

/**
 * Worker BullMQ pour le cycle de vie des classes.
 *
 * Pourquoi BullMQ plutôt qu'un @Cron NestJS ?
 *  - BullMQ persiste le job dans Redis : si le process redémarre pendant la
 *    nuit, le job ne sera pas perdu (il sera repris au redémarrage).
 *  - La répétition est gérée côté Redis (pas de dépendance à l'uptime du process).
 *  - La trace d'exécution (completed/failed) est visible dans Redis.
 *
 * Un seul job répétitif est enregistré au démarrage (idempotent via jobId fixe).
 */
@Processor(LIFECYCLE_QUEUE)
export class LifecycleWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(LifecycleWorker.name);
  private readonly cron:   string;

  constructor(
    @InjectQueue(LIFECYCLE_QUEUE) private readonly lifecycleQueue: Queue,
    private readonly lifecycleService: LifecycleService,
    configService: ConfigService,
  ) {
    super();
    const cfg = configService.getOrThrow<LifecycleConfig>('lifecycle');
    this.cron = cfg.cron;
  }

  /**
   * Enregistre le job répétitif au démarrage du module.
   * `jobId: 'lifecycle-cron-singleton'` garantit qu'une seule instance du job
   * existe dans Redis, même après plusieurs redémarrages ou déploiements.
   */
  async onModuleInit(): Promise<void> {
    await this.lifecycleQueue.add(
      LIFECYCLE_JOB,
      {},
      {
        jobId:  'lifecycle-cron-singleton',
        repeat: { pattern: this.cron },
        // Pas de removeOnComplete/Fail très bas : on garde les 3 derniers
        // runs pour diagnostic si quelque chose se passe mal la nuit.
        removeOnComplete: { count: 3 },
        removeOnFail:     { count: 3 },
      },
    );

    this.logger.log(`Lifecycle cron enregistré : ${this.cron}`);
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Lifecycle job ${job.id} démarré.`);
    await this.lifecycleService.runAllTransitions();
    this.logger.log(`Lifecycle job ${job.id} terminé.`);
  }
}
