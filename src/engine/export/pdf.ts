import { PDFDocument } from 'pdf-lib'

export interface PdfPage {
  jpeg: Blob
  width: number
  height: number
}

/** One image per page, page size = image size in points at 72 dpi. */
export async function buildPdf(pages: PdfPage[]): Promise<Blob> {
  const doc = await PDFDocument.create()
  for (const item of pages) {
    const bytes = new Uint8Array(await item.jpeg.arrayBuffer())
    const image = await doc.embedJpg(bytes)
    const page = doc.addPage([item.width, item.height])
    page.drawImage(image, { x: 0, y: 0, width: item.width, height: item.height })
  }
  const data = await doc.save()
  return new Blob([data as unknown as BlobPart], { type: 'application/pdf' })
}
