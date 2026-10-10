import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LifecycleService } from './lifecycle.service';
import { LifecycleWorker, LIFECYCLE_QUEUE } from './lifecycle.worker';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: LIFECYCLE_QUEUE }),
    NotificationsModule,
    StorageModule,
    AuditModule,
  ],
  providers: [LifecycleService, LifecycleWorker],
  exports: [LifecycleService],
})
export class LifecycleModule {}
