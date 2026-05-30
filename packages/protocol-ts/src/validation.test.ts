/**
 * Unit tests for protocol validation rules.
 *
 * Validates: Requirements 8.3, 8.4, 8.5, 8.6, 12.7
 */

import { describe, expect, it } from 'vitest';
import { APP_PROTOCOL } from './constants.js';
import type { Capabilities, DeviceInfo } from './models.js';
import { validateCapabilities, validateDeviceInfo } from './validation.js';

const baseDeviceInfo: DeviceInfo = {
  alias: 'Nice Orange',
  version: '2.1',
  deviceModel: 'Pixel 8',
  deviceType: 'mobile',
  fingerprint: 'f1a2b3c4',
  port: 53317,
  protocol: 'http',
  download: false,
};

const baseCapabilities: Capabilities = {
  appProtocol: APP_PROTOCOL,
  parallelChunkedSend: true,
  parallelChunkedReceive: true,
  maxParallelConnections: 6,
  minChunkSize: 1024,
  maxChunkSize: 8 * 1024 * 1024,
  chunkProtocolVersions: ['wd-chunk/1'],
};

/** Pull the set of failing field names out of a validation result. */
function failedFields(result: ReturnType<typeof validateDeviceInfo>): string[] {
  return result.valid ? [] : result.errors.map((e) => e.field);
}

describe('validateDeviceInfo', () => {
  it('accepts a valid DeviceInfo', () => {
    expect(validateDeviceInfo(baseDeviceInfo).valid).toBe(true);
  });

  it('rejects an empty alias and names the alias field', () => {
    const result = validateDeviceInfo({ ...baseDeviceInfo, alias: '' });
    expect(result.valid).toBe(false);
    expect(failedFields(result)).toContain('alias');
  });

  it('rejects an alias longer than 64 characters', () => {
    const result = validateDeviceInfo({ ...baseDeviceInfo, alias: 'a'.repeat(65) });
    expect(failedFields(result)).toContain('alias');
  });

  it('accepts an alias of exactly 64 characters', () => {
    expect(validateDeviceInfo({ ...baseDeviceInfo, alias: 'a'.repeat(64) }).valid).toBe(true);
  });

  it('rejects a port below 1024 and at/above bounds correctly', () => {
    expect(validateDeviceInfo({ ...baseDeviceInfo, port: 1023 }).valid).toBe(false);
    expect(validateDeviceInfo({ ...baseDeviceInfo, port: 1024 }).valid).toBe(true);
    expect(validateDeviceInfo({ ...baseDeviceInfo, port: 65535 }).valid).toBe(true);
    expect(validateDeviceInfo({ ...baseDeviceInfo, port: 65536 }).valid).toBe(false);
  });

  it('rejects an empty fingerprint and names the fingerprint field', () => {
    const result = validateDeviceInfo({ ...baseDeviceInfo, fingerprint: '' });
    expect(failedFields(result)).toContain('fingerprint');
  });

  it('rejects a protocol other than http or https', () => {
    const result = validateDeviceInfo({
      ...baseDeviceInfo,
      protocol: 'ftp' as DeviceInfo['protocol'],
    });
    expect(failedFields(result)).toContain('protocol');
  });

  it('reports multiple invalid fields at once', () => {
    const result = validateDeviceInfo({
      ...baseDeviceInfo,
      alias: '',
      port: 10,
      fingerprint: '',
    });
    const fields = failedFields(result);
    expect(fields).toEqual(expect.arrayContaining(['alias', 'port', 'fingerprint']));
  });
});

describe('validateCapabilities', () => {
  it('accepts valid Capabilities', () => {
    expect(validateCapabilities(baseCapabilities).valid).toBe(true);
  });

  it('rejects a non-WrapDrive appProtocol', () => {
    const result = validateCapabilities({ ...baseCapabilities, appProtocol: 'other/9' });
    expect(failedFields(result)).toContain('appProtocol');
  });

  it('rejects minChunkSize <= 0', () => {
    expect(failedFields(validateCapabilities({ ...baseCapabilities, minChunkSize: 0 }))).toContain(
      'minChunkSize',
    );
  });

  it('rejects minChunkSize greater than maxChunkSize', () => {
    const result = validateCapabilities({
      ...baseCapabilities,
      minChunkSize: 1000,
      maxChunkSize: 500,
    });
    expect(failedFields(result)).toContain('minChunkSize');
  });

  it('rejects maxParallelConnections < 1', () => {
    expect(
      failedFields(validateCapabilities({ ...baseCapabilities, maxParallelConnections: 0 })),
    ).toContain('maxParallelConnections');
  });

  it('accepts minChunkSize equal to maxChunkSize', () => {
    expect(
      validateCapabilities({ ...baseCapabilities, minChunkSize: 4096, maxChunkSize: 4096 }).valid,
    ).toBe(true);
  });
});
