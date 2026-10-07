import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createSupabaseApi } from './supabase-api.mjs';
import { createDocumentAnalyzer } from './document-analysis.mjs';
import { createNoticeGenerator } from './notice-generation.mjs';
import { createPublicHolidayCalendar } from './public-holidays.mjs';
import { createGoogleSheetsService } from './google-sheets-service.mjs';
import { DEFAULT_GEMINI_MODEL } from './gemini-config.mjs';

function localEnv() {
  try {
    const contents=readFileSync(new URL('../.env',import.meta.url),'utf8');
    return Object.fromEntries(contents.split(/\r?\n/).filter(line=>line && !line.trimStart().startsWith('#')).map(line=>{
      const at=line.indexOf('=');
      return at<0?[]:[line.slice(0,at).trim(),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')];
    }).filter(pair=>pair.length===2));
  } catch {return {};}
}
const env=localEnv();
const handleApi=createSupabaseApi({
  url:process.env.SUPABASE_URL||env.SUPABASE_URL,
  key:process.env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_PUBLISHABLE_KEY,
  analyzer:createDocumentAnalyzer({apiKey:process.env.GEMINI_API_KEY||env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL}),
  noticeGenerator:createNoticeGenerator({apiKey:process.env.GEMINI_API_KEY||env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL||env.GEMINI_MODEL||DEFAULT_GEMINI_MODEL}),
  holidayCalendar:createPublicHolidayCalendar(),
  sheetService:createGoogleSheetsService({
    spreadsheetId:process.env.GOOGLE_SHEETS_SPREADSHEET_ID||env.GOOGLE_SHEETS_SPREADSHEET_ID,
    clientEmail:process.env.GOOGLE_SHEETS_CLIENT_EMAIL||env.GOOGLE_SHEETS_CLIENT_EMAIL,
    privateKey:process.env.GOOGLE_SHEETS_PRIVATE_KEY||env.GOOGLE_SHEETS_PRIVATE_KEY,
  }),
});

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/fonts/PretendardVariable.woff2', ['fonts/PretendardVariable.woff2', 'font/woff2']],
  ['/document-import.css', ['document-import.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/supabase-browser.js', ['supabase-browser.js', 'text/javascript; charset=utf-8']],
  ['/draft-storage-id.js', ['draft-storage-id.js', 'text/javascript; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/rule-engine.js', ['rule-engine.js', 'text/javascript; charset=utf-8']],
  ['/registration-summary.js', ['registration-summary.js', 'text/javascript; charset=utf-8']],
  ['/notice-generation-input.js', ['notice-generation-input.js', 'text/javascript; charset=utf-8']],
  ['/operator-merge.js', ['operator-merge.js', 'text/javascript; charset=utf-8']],
  ['/notice-resources.js', ['notice-resources.js', 'text/javascript; charset=utf-8']],
  ['/notice-resource-store.js', ['notice-resource-store.js', 'text/javascript; charset=utf-8']],
  ['/document-extract.js', ['document-extract.js', 'text/javascript; charset=utf-8']],
  ['/analysis-contract.js', ['analysis-contract.js', 'text/javascript; charset=utf-8']],
  ['/document-import.js', ['document-import.js', 'text/javascript; charset=utf-8']],
  ['/message-templates.js', ['message-templates.js', 'text/javascript; charset=utf-8']],
  ['/notice-draft.js', ['notice-draft.js', 'text/javascript; charset=utf-8']],
  ['/send-preflight.js', ['send-preflight.js', 'text/javascript; charset=utf-8']],
  ['/sheet-application-merge.js', ['sheet-application-merge.js', 'text/javascript; charset=utf-8']],
  ['/sheet-sync-feedback.js', ['sheet-sync-feedback.js', 'text/javascript; charset=utf-8']],
  ['/project-id.js', ['project-id.js', 'text/javascript; charset=utf-8']],
  ['/recipient-selection.js', ['recipient-selection.js', 'text/javascript; charset=utf-8']],
]);
const requestedPort = process.env.PORT ?? '3000';
if (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const port = Number(requestedPort);

const server = createServer(async (req, res) => {
  const hostname=String(req.headers.host||'').split(':')[0];
  if(!['localhost','127.0.0.1'].includes(hostname)){res.writeHead(403);res.end();return;}
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if(pathname.startsWith('/api/')){await handleApi(req,res,pathname);return;}
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = assets.get(pathname);
  if (!asset) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const html = await readFile(new URL(`../prototype/${asset[0]}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': asset[1],
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(`정적 파일 제공 실패: ${pathname} (${error.code ?? error.message})`);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`요청한 파일을 읽지 못했습니다: ${pathname}. 실행 폴더의 prototype 파일을 확인해주세요.`);
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `${port} 포트가 사용 중입니다. 다른 PORT를 지정하거나 기존 실행을 종료해주세요.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Prototype ready: http://localhost:${port}`));
