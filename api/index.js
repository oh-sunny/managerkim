import { createSupabaseApi } from '../scripts/supabase-api.mjs';
import { createDocumentAnalyzer } from '../scripts/document-analysis.mjs';
import { createNoticeGenerator } from '../scripts/notice-generation.mjs';

export const config = { maxDuration: 180 };

const handleApi = createSupabaseApi({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  analyzer: createDocumentAnalyzer({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMMA_MODEL}),
  noticeGenerator: createNoticeGenerator({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMMA_MODEL}),
});

export default async function handler(req, res) {
  const route = req.query?.route;
  const segments = Array.isArray(route) ? route : typeof route === 'string' ? route.split('/') : [];
  const pathname = `/api/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
  await handleApi(req, res, pathname);
}
