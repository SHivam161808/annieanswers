import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Structured JSON logs. Logs carry ids, status, outcome codes, latency and error codes only.
 * Request/response bodies are never logged; the redact list is a second line of defence.
 */
export const PII_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-annie-secret"]',
  '*.phone',
  '*.phone_number',
  '*.caller_number',
  '*.from_number',
  '*.name',
  '*.first_name',
  '*.last_name',
  '*.full_name',
  '*.email',
  '*.address',
  '*.job_address',
  '*.postcode',
  '*.transcript',
  '*.notes',
];

export interface LoggerOptions {
  level: string;
  appEnv: string;
  version: string;
}

export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'annie-api', env: options.appEnv, version: options.version },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: PII_REDACT_PATHS, censor: '[REDACTED]' },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
