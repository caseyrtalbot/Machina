/**
 * Hand-written minimal 3-page PDF (raw PDF syntax, uncompressed text streams)
 * for the 3.10a extraction tests. Built at test time so the xref offsets are
 * computed, the page texts stay assertable constants, and no binary fixture
 * needs committing.
 */

export const PAGE_TEXTS = [
  'First page introduces the fixture document.',
  'The luminous archive sits quietly on page two.',
  'Third page concludes the fixture with a farewell.'
] as const

export function buildThreePagePdf(): Uint8Array {
  const objects: string[] = []
  // 1: catalog, 2: page tree, 3-5: pages, 6-8: content streams, 9: font
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>'
  for (let i = 0; i < 3; i++) {
    objects[3 + i] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 9 0 R >> >> /Contents ${6 + i} 0 R >>`
  }
  for (let i = 0; i < 3; i++) {
    const stream = `BT /F1 12 Tf 72 720 Td (${PAGE_TEXTS[i]}) Tj ET`
    objects[6 + i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  objects[9] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let n = 1; n <= 9; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`
  }
  const xrefStart = out.length
  out += 'xref\n0 10\n0000000000 65535 f \n'
  for (let n = 1; n <= 9; n++) {
    out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  // ASCII-only content, so charCodeAt maps 1:1 onto bytes.
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0))
}
