const builtInOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://managerkim.vercel.app',
]);

export function syncCorsHeaders(origin, configuredOrigin = '') {
  if (!origin) return null;
  const allowed = new Set(builtInOrigins);
  if (configuredOrigin) {
    try { allowed.add(new URL(configuredOrigin).origin); }
    catch { /* An invalid setting must not widen browser access. */ }
  }
  if (!allowed.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
}
