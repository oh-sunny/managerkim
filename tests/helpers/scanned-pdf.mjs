import { createCanvas } from '@napi-rs/canvas';

// An image-only PDF fixture. No hidden text layer; tests exercise automatic OCR.
export function scannedPdf() {
  const canvas=createCanvas(1000,650),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1000,650);ctx.fillStyle='black';ctx.font='30px Arial';
  const lines=['Autumn Workshop','Event: 2026-11-12 at 14:00','Venue: Main Office, Floor 3','Audience: All employees','Application deadline: 2026-11-08 at 18:00','Contact: Kim','Application URL: https://example.org/workshop'];
  lines.forEach((line,index)=>ctx.fillText(line,40,70+index*70));
  const jpeg=canvas.toBuffer('image/jpeg');
  const objects=[
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 650] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 650 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),
  ];
  const paint='q 1000 0 0 650 0 0 cm /Im0 Do Q';
  objects.push(Buffer.from(`<< /Length ${paint.length} >>\nstream\n${paint}\nendstream`));
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
  objects.forEach((object,index)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
