'use client';

export function getLocalPdfWorkerSrc() {
  return new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
}

export function getReactPdfWorkerSrc() {
  return new URL('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
}
