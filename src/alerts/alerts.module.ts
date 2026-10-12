import { Global, Module } from '@nestjs/common';
import { getAlertsConfig } from '../config/alerts.config';
import { AlertService } from './alert.service';
import { ALERTS_CONFIG } from './constants';

/** Global, so any module can inject AlertService without importing this one. */
@Global()
@Module({
  providers: [{ provide: ALERTS_CONFIG, useFactory: getAlertsConfig }, AlertService],
  exports: [AlertService],
})
export class AlertsModule {}
