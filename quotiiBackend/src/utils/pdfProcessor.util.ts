/**
 * Resolve a PdfProcessor route from PDF_PROCESSOR_ENDPOINT.
 *
 * The env var may be either a base URL (http://host:5000) or the legacy full
 * path to /process-pdf. Strip known route suffixes so callers can target
 * /index-pdf and /retry-index without a second env var.
 */
export function pdfProcessorUrl(
  path: '/index-pdf' | '/retry-index' | '/process-pdf',
  endpoint: string | undefined = process.env.PDF_PROCESSOR_ENDPOINT
): string {
  if (!endpoint) {
    throw new Error('PDF_PROCESSOR_ENDPOINT is not configured');
  }
  const base = endpoint.replace(
    /\/(process-pdf|index-pdf|retry-index)\/?$/i,
    ''
  );
  return `${base.replace(/\/$/, '')}${path}`;
}
