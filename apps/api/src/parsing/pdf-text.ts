import pdfParse from "pdf-parse";

/** Extract plain text from a PDF's bytes (text-layer PDFs — no OCR). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text;
}
