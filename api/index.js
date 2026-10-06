import { createSupabaseApi } from '../scripts/supabase-api.mjs';

const handleApi = createSupabaseApi({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
});

export default async function handler(req, res) {
  const route = req.query?.route;
  const segments = Array.isArray(route) ? route : typeof route === 'string' ? route.split('/') : [];
  const pathname = `/api/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
  await handleApi(req, res, pathname);
}
