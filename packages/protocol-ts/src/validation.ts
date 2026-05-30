/**
 * Validation for WrapDrive protocol messages.
 *
 * Validators return a {@link ValidationResult} rather than throwing, so callers
 * (HTTP handlers, the negotiator) can decide how to surface failures. Each
 * failure identifies the offending field, satisfying the protocol requirement
 * that rejections name the invalid field.
 */

import { APP_PROTOCOL, MAX_ALIAS_LENGTH, MAX_PORT, MIN_PORT } from './constants.js';
import type { Capabilities, DeviceInfo, Protocol } from './models.js';

/** A single validation failure, naming the field and why it was rejected. */
export interface ValidationError {
  /** Dotted path of the offending field, e.g. `"port"` or `"minChunkSize"`. */
  field: string;
  /** Human-readable explanation of the violation. */
  message: string;
}

/** The outcome of validating a message: either valid, or a list of errors. */
export type ValidationResult = { valid: true } | { valid: false; errors: ValidationError[] };

const VALID_PROTOCOLS: readonly Protocol[] = ['http', 'https'];

const VALID = (): ValidationResult => ({ valid: true });

const INVALID = (errors: ValidationError[]): ValidationResult => ({
  valid: false,
  errors,
});

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

/**
 * Validate a {@link DeviceInfo} against the protocol rules:
 * non-empty alias <= 64 chars, port in [1024, 65535], non-empty fingerprint,
 * and a `protocol` of `http` or `https`.
 */
export function validateDeviceInfo(info: DeviceInfo): ValidationResult {
  const errors: ValidationError[] = [];

  if (info.alias.length === 0) {
    errors.push({ field: 'alias', message: 'alias must not be empty' });
  } else if (info.alias.length > MAX_ALIAS_LENGTH) {
    errors.push({
      field: 'alias',
      message: `alias must be at most ${MAX_ALIAS_LENGTH} characters`,
    });
  }

  if (!isInteger(info.port) || info.port < MIN_PORT || info.port > MAX_PORT) {
    errors.push({
      field: 'port',
      message: `port must be an integer within [${MIN_PORT}, ${MAX_PORT}]`,
    });
  }

  if (info.fingerprint.length === 0) {
    errors.push({ field: 'fingerprint', message: 'fingerprint must not be empty' });
  }

  if (!VALID_PROTOCOLS.includes(info.protocol)) {
    errors.push({ field: 'protocol', message: "protocol must be 'http' or 'https'" });
  }

  return errors.length === 0 ? VALID() : INVALID(errors);
}

/**
 * Validate a {@link Capabilities} against the protocol rules:
 * `minChunkSize > 0`, `minChunkSize <= maxChunkSize`, and
 * `maxParallelConnections >= 1`. The `appProtocol` is also checked to be the
 * WrapDrive identifier.
 */
export function validateCapabilities(caps: Capabilities): ValidationResult {
  const errors: ValidationError[] = [];

  if (caps.appProtocol !== APP_PROTOCOL) {
    errors.push({
      field: 'appProtocol',
      message: `appProtocol must be '${APP_PROTOCOL}'`,
    });
  }

  if (!isInteger(caps.minChunkSize) || caps.minChunkSize <= 0) {
    errors.push({
      field: 'minChunkSize',
      message: 'minChunkSize must be a positive integer',
    });
  }

  if (!isInteger(caps.maxChunkSize) || caps.maxChunkSize <= 0) {
    errors.push({
      field: 'maxChunkSize',
      message: 'maxChunkSize must be a positive integer',
    });
  }

  if (
    isInteger(caps.minChunkSize) &&
    isInteger(caps.maxChunkSize) &&
    caps.minChunkSize > caps.maxChunkSize
  ) {
    errors.push({
      field: 'minChunkSize',
      message: 'minChunkSize must not exceed maxChunkSize',
    });
  }

  if (!isInteger(caps.maxParallelConnections) || caps.maxParallelConnections < 1) {
    errors.push({
      field: 'maxParallelConnections',
      message: 'maxParallelConnections must be an integer >= 1',
    });
  }

  return errors.length === 0 ? VALID() : INVALID(errors);
}

/** Convenience guard: `true` when the {@link DeviceInfo} passes validation. */
export function isValidDeviceInfo(info: DeviceInfo): boolean {
  return validateDeviceInfo(info).valid;
}

/** Convenience guard: `true` when the {@link Capabilities} passes validation. */
export function isValidCapabilities(caps: Capabilities): boolean {
  return validateCapabilities(caps).valid;
}
