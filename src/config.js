const DEFAULT_PORT = 3000;
const DEFAULT_MAX_UPLOAD_MB = 50;
const DEFAULT_JSON_BODY_LIMIT_MB = 30;

function parsePositiveInt(rawValue, name, fallback) {
  if (rawValue == null || rawValue === '') return fallback;
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} deve essere un intero positivo.`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const port = parsePositiveInt(env.PORT, 'PORT', DEFAULT_PORT);
  const maxUploadMb = parsePositiveInt(env.MAX_UPLOAD_MB, 'MAX_UPLOAD_MB', DEFAULT_MAX_UPLOAD_MB);
  const jsonBodyLimitMb = parsePositiveInt(
    env.JSON_BODY_LIMIT_MB,
    'JSON_BODY_LIMIT_MB',
    DEFAULT_JSON_BODY_LIMIT_MB,
  );

  return {
    environment: env.NODE_ENV || 'development',
    port,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxUploadMb,
    jsonBodyLimit: `${jsonBodyLimitMb}mb`,
    version: env.APP_VERSION || env.npm_package_version || 'dev',
  };
}
