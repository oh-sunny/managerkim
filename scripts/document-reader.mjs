import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';
import { ANALYSIS_LIMITS as limits } from '../web/analysis-contract.js';

export const analysisError = (message, status = 422) => Object.assign(new Error(message), { status, publicMessage: message });
const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const xmlParser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false, processEntities: true });

function segments(text, label, method = 'text') {
  return text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).flatMap((paragraph, i) => {
    const parts = [];
    for (let at = 0; at < paragraph.length; at += 1600) {
      const text = paragraph.slice(at, at + 1600).trim();
      if (text) parts.push({ location: `${label} · ${i + 1}문단${at ? ` (${at + 1}자부터)` : ''}`, text, method });
    }
    return parts;
  });
}

async function readDocx(data) {
  const zip = await yauzl.fromBufferPromise(data, { lazyEntries: true });
  const entries = new Map(); let expanded = 0, count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      expanded += entry.uncompressedSize;
      if (++count > 500 || expanded > 16_000_000 || entry.generalPurposeBitFlag & 1) throw analysisError('암호화되었거나 압축 해제 크기가 큰 DOCX입니다.');
      if (!/^word\/(document\.xml|_rels\/document\.xml\.rels|header\d+\.xml|footer\d+\.xml|footnotes\.xml|endnotes\.xml)$/.test(entry.fileName)) continue;
      const stream = await zip.openReadStreamPromise(entry), chunks = []; let size = 0;
      for await (const chunk of stream) { size += chunk.length; if (size > 4_000_000) throw analysisError('DOCX 본문이 너무 큽니다.'); chunks.push(chunk); }
      const text = Buffer.concat(chunks).toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw analysisError('지원하지 않는 XML 선언이 있는 DOCX입니다.');
      entries.set(entry.fileName, xmlParser.parse(text));
    }
  } finally { zip.close(); }
  if (!entries.has('word/document.xml')) throw analysisError('유효한 DOCX 본문을 찾지 못했습니다.');
  const links = new Map();
  function relationships(nodes) {
    for (const node of nodes || []) for (const [tag, children] of Object.entries(node)) {
      if (tag === 'Relationship' && /^https?:\/\//.test(node[':@']?.['@_Target'] || '')) links.set(node[':@']['@_Id'], node[':@']['@_Target']);
      if (Array.isArray(children)) relationships(children);
    }
  }
  relationships(entries.get('word/_rels/document.xml.rels'));
  function plain(nodes) {
    let out = '';
    for (const node of nodes || []) for (const [tag, children] of Object.entries(node)) {
      if (tag === ':@' || tag === 'w:del') continue;
      if (tag === '#text') out += children;
      else if (tag === 'w:tab') out += ' ';
      else if (tag === 'w:br') out += '\n';
      else if (Array.isArray(children)) {
        out += plain(children);
        if (tag === 'w:hyperlink' && links.has(node[':@']?.['@_r:id'])) out += ` (${links.get(node[':@']['@_r:id'])})`;
        if (tag === 'w:p') out += '\n\n';
      }
    }
    return out;
  }
  return [...entries].filter(([name]) => !name.endsWith('.rels')).flatMap(([name, nodes]) => segments(plain(nodes), name === 'word/document.xml' ? '본문' : name.replace('word/','')));
}

async function readPdf(data, sourceId, forceOcr) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true,
    standardFontDataUrl: pathToFileURL(join(pdfRoot,'standard_fonts') + '/').href,
    cMapUrl: pathToFileURL(join(pdfRoot,'cmaps') + '/').href, cMapPacked: true,
    verbosity: 0 });
  const result = [], images = [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages > limits.pages) throw analysisError(`PDF는 파일당 ${limits.pages}쪽까지 읽을 수 있습니다.`);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      if (!forceOcr && text.replace(/\s/g,'').length >= 25 && !text.includes('\uFFFD')) result.push(...segments(text, `${n}쪽`));
      else {
        if (images.length >= limits.ocrPages) throw analysisError(`OCR은 한 번에 ${limits.ocrPages}쪽까지 가능합니다. PDF를 나누어 올려주세요.`);
        const { createCanvas } = await import('@napi-rs/canvas');
        const size = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1800 / Math.max(size.width, size.height));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push({ id: `${sourceId}-p${n}`, sourceId, location: `${n}쪽`, data: canvas.toBuffer('image/png').toString('base64') });
        canvas.width = 1; canvas.height = 1;
      }
      page.cleanup();
    }
    return { segments: result, images, pageCount: pdf.numPages };
  } finally { await task.destroy(); }
}

export async function readDocuments(input) {
  if (!input || !Array.isArray(input.files) || input.files.length > limits.files || typeof input.text !== 'string' || input.text.length > limits.textChars || typeof input.forceOcr !== 'boolean') throw analysisError('자료 형식과 개수·텍스트 길이를 확인해주세요.', 400);
  if (!input.files.length && !input.text.trim()) throw analysisError('파일을 선택하거나 내용을 붙여넣어 주세요.', 400);
  let totalBytes = 0; const sources = [], images = [];
  for (const [index, file] of input.files.entries()) {
    if (!file || typeof file.name !== 'string' || file.name.length > 160 || !file.name.trim() || /[\\/\x00-\x1f]/.test(file.name) || typeof file.data !== 'string' || file.data.length > 2_666_672 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw analysisError('파일 이름 또는 업로드 형식을 확인해주세요.', 400);
    const data = Buffer.from(file.data, 'base64'); totalBytes += data.length;
    if (!data.length || data.length > limits.fileBytes || totalBytes > limits.totalBytes) throw analysisError('파일은 개별 2MB, 전체 2.8MB까지 올릴 수 있습니다.', 413);
    const ext = file.name.split('.').pop().toLowerCase(), id = `source-${index + 1}`;
    const source = { id, name: file.name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), segments: [], pageCount: null };
    try {
      if (ext === 'pdf' && data.subarray(0,5).toString() === '%PDF-') {
        const parsed = await readPdf(data, id, input.forceOcr); source.segments = parsed.segments; source.pageCount = parsed.pageCount; images.push(...parsed.images);
        if (images.length > limits.ocrPages) throw analysisError(`OCR 대상은 전체 ${limits.ocrPages}쪽까지 가능합니다. 자료를 나누어 올려주세요.`);
      } else if (ext === 'docx' && data.subarray(0,2).toString() === 'PK') source.segments = await readDocx(data);
      else if (['txt','md'].includes(ext)) source.segments = segments(new TextDecoder('utf-8',{ fatal: true }).decode(data), '텍스트');
      else throw analysisError('PDF·DOCX·UTF-8 TXT·MD 파일을 선택해주세요.');
    } catch (error) { throw analysisError(`${file.name}: ${error.publicMessage || '파일을 읽지 못했습니다. 암호·손상 여부와 형식을 확인해주세요.'}`, error.status || 422); }
    if (!source.segments.length && !images.some(image => image.sourceId === id)) throw analysisError(`${file.name}: 읽을 수 있는 본문이 없습니다. 이미지가 들어 있는 Word 문서는 PDF로 저장해 올려주세요.`);
    sources.push(source);
  }
  if (input.text.trim()) sources.push({ id: 'pasted', name: '붙여넣은 내용', segments: segments(input.text,'텍스트'), sha256: createHash('sha256').update(input.text).digest('hex') });
  if (images.length > limits.ocrPages) throw analysisError(`OCR 대상은 전체 ${limits.ocrPages}쪽까지 가능합니다. 자료를 나누어 올려주세요.`);
  finalizeSegments(sources);
  return { sources, images };
}

export function finalizeSegments(sources) {
  let length = 0;
  for (const source of sources) source.segments.forEach((segment, index) => { segment.id = `${source.id}-s${index + 1}`; length += segment.text.length; });
  if (length > limits.textChars) throw analysisError('추출된 텍스트가 8만 자를 넘습니다. 자료를 나누어 분석해주세요.', 413);
}

export function applyOcr(sources, images, response) {
  if (!Array.isArray(response?.pages) || response.pages.length !== images.length) throw analysisError('OCR 결과의 페이지 수가 맞지 않습니다. 다시 분석해주세요.', 502);
  for (const image of images) {
    const matches = response.pages.filter(page => page.id === image.id);
    if (matches.length !== 1 || typeof matches[0].text !== 'string' || !matches[0].text.trim()) throw analysisError(`${sources.find(s => s.id === image.sourceId).name} ${image.location}: 글자를 읽지 못했습니다. 더 선명한 자료가 필요합니다.`);
    if (matches[0].text.length > limits.textChars) throw analysisError('OCR 결과가 너무 큽니다.', 413);
    sources.find(source => source.id === image.sourceId).segments.push(...segments(matches[0].text, image.location, 'ocr'));
  }
  finalizeSegments(sources);
}
