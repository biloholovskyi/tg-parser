import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ALERTS_API_KEY_ENV_VAR,
  ALERTS_SERVICE_NAME_ENV_VAR,
  ALERTS_URL_ENV_VAR,
} from '../config/alerts.config';
import { AlertService } from './alert.service';
import { AlertsModule } from './alerts.module';
import { BootConfigReporter } from './boot-config-reporter';
import { ALERTS_CONFIG } from './constants';

const ENV_VARS = [ALERTS_URL_ENV_VAR, ALERTS_API_KEY_ENV_VAR, ALERTS_SERVICE_NAME_ENV_VAR];

describe('AlertsModule', () => {
  const originalEnv = new Map(ENV_VARS.map((name) => [name, process.env[name]]));
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    ENV_VARS.forEach((name) => delete process.env[name]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    originalEnv.forEach((value, name) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it('resolves a disabled AlertService without env and never calls fetch', async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({ imports: [AlertsModule] }).compile();

    // Act
    const actualService = moduleRef.get(AlertService);
    actualService.error('fake error');
    await Promise.resolve();

    // Assert
    expect(actualService).toBeInstanceOf(AlertService);
    expect(moduleRef.get(ALERTS_CONFIG)).toMatchObject({ isEnabled: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('provides BootConfigReporter and runs it once on init without reaching the network', async () => {
    // Arrange
    const reportSpy = jest.spyOn(BootConfigReporter.prototype, 'onApplicationBootstrap');
    const moduleRef = await Test.createTestingModule({ imports: [AlertsModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });

    // Act
    await app.init();

    // Assert
    expect(moduleRef.get(BootConfigReporter)).toBeInstanceOf(BootConfigReporter);
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
