import { HttpError, invalid } from './http.ts';

/**
 * Small hand written validator.
 *
 * Every mutating route validates its body before it touches the database, so malformed
 * input can never reach SQLite and error messages stay stable for the tests.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown, field = 'body'): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw invalid(`\`${field}\` must be a JSON object.`);
  }
  return value;
}

export interface StringOptions {
  min?: number;
  max?: number;
  required?: boolean;
  trim?: boolean;
  field?: string;
  pattern?: RegExp;
}

export function asString(value: unknown, field: string, options: StringOptions = {}): string {
  const { min = 1, max = 2_000, required = true } = options;
  if (value === undefined || value === null) {
    if (!required) return '';
    throw invalid(`\`${field}\` is required.`);
  }
  if (typeof value !== 'string') throw invalid(`\`${field}\` must be a string.`);
  const trimmed = options.trim === false ? value : value.trim();
  if (required && trimmed.length === 0) throw invalid(`\`${field}\` must not be empty.`);
  if (trimmed.length < min) {
    throw invalid(`\`${field}\` must be at least ${min} character${min === 1 ? '' : 's'}.`);
  }
  if (trimmed.length > max) {
    throw invalid(`\`${field}\` must be at most ${max} characters.`);
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw invalid(`\`${field}\` has an invalid format.`);
  }
  return trimmed;
}

export function asOptionalString(
  value: unknown,
  field: string,
  options: StringOptions = {},
): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asString(value, field, { ...options, required: false });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function asEmail(value: unknown, field = 'email'): string {
  const email = asString(value, field, { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw invalid(`\`${field}\` must be a valid email address.`);
  return email;
}

export function asBoolean(value: unknown, field: string, options: { required?: boolean } = {}): boolean {
  if (value === undefined || value === null) {
    if (options.required) throw invalid(`\`${field}\` is required.`);
    return false;
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw invalid(`\`${field}\` must be a boolean.`);
}

export function asOptionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw invalid(`\`${field}\` must be a boolean.`);
}

export interface IntOptions {
  min?: number;
  max?: number;
  required?: boolean;
}

export function asInt(value: unknown, field: string, options: IntOptions = {}): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = true } = options;
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(`\`${field}\` is required.`);
    throw invalid(`\`${field}\` is required.`);
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw invalid(`\`${field}\` must be an integer.`);
  }
  if (parsed < min) throw invalid(`\`${field}\` must be at least ${min}.`);
  if (parsed > max) throw invalid(`\`${field}\` must be at most ${max}.`);
  return parsed;
}

export function asNumber(value: unknown, field: string, options: IntOptions = {}): number {
  const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  if (value === undefined || value === null || value === '') {
    throw invalid(`\`${field}\` is required.`);
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw invalid(`\`${field}\` must be a number.`);
  if (parsed < min) throw invalid(`\`${field}\` must be at least ${min}.`);
  if (parsed > max) throw invalid(`\`${field}\` must be at most ${max}.`);
  return parsed;
}

export function asEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  options: { required?: boolean; fallback?: T } = {},
): T {
  if (value === undefined || value === null || value === '') {
    if (options.fallback !== undefined) return options.fallback;
    if (options.required === false) return '' as T;
    throw invalid(`\`${field}\` is required.`);
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalid(`\`${field}\` must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function asStringArray(value: unknown, field: string, max = 50): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > max) throw invalid(`\`${field}\` must contain at most ${max} entries.`);
  return list.map((entry, index) => asString(entry, `${field}[${index}]`, { max: 120 }));
}

export function asIsoDate(value: unknown, field: string): string {
  const raw = asString(value, field, { max: 40 });
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw invalid(`\`${field}\` must be an ISO-8601 date.`);
  return new Date(parsed).toISOString();
}

/** Collects validation problems instead of throwing on the first one. */
export function collectErrors(fn: () => void): string[] {
  try {
    fn();
    return [];
  } catch (error) {
    if (error instanceof HttpError && Array.isArray(error.details)) {
      return error.details.map((entry) => String(entry));
    }
    return [error instanceof Error ? error.message : String(error)];
  }
}

export function validationDetails(errors: string[]): never {
  throw invalid(errors[0] ?? 'Invalid input.', errors);
}
