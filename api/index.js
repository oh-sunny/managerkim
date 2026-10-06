import { createSupabaseApi } from '../scripts/supabase-api.mjs';
import { createDocumentAnalyzer } from '../scripts/document-analysis.mjs';
import { createNoticeGenerator } from '../scripts/notice-generation.mjs';
import { createPublicHolidayCalendar } from '../scripts/public-holidays.mjs';
import { createGoogleSheetsService } from '../scripts/google-sheets-service.mjs';
import { DEFAULT_GEMINI_MODEL } from '../scripts/gemini-config.mjs';

export const config = { maxDuration: 180 };

const handleApi = createSupabaseApi({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  analyzer: createDocumentAnalyzer({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL}),
  noticeGenerator: createNoticeGenerator({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL}),
  holidayCalendar: createPublicHolidayCalendar(),
  sheetService:createGoogleSheetsService({
    spreadsheetId:process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    clientEmail:process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    privateKey:process.env.GOOGLE_SHEETS_PRIVATE_KEY,
  }),
});

export default async function handler(req, res) {
  const route = req.query?.route;
  const segments = Array.isArray(route) ? route : typeof route === 'string' ? route.split('/') : [];
  const pathname = `/api/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
  await handleApi(req, res, pathname);
}
