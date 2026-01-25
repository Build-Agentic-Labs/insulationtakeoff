import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Configure PDF.js worker for Node.js environment
if (typeof window === 'undefined') {
  // Point to the legacy worker file
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
}

export interface PDFPageImage {
  pageNumber: number;
  imageData: string; // base64 encoded PNG
  width: number;
  height: number;
}

export async function convertPDFToImages(
  pdfBuffer: ArrayBuffer,
  options: {
    maxPages?: number;
    scale?: number;
  } = {}
): Promise<PDFPageImage[]> {
  const { maxPages, scale = 2 } = options;

  try {
    const pdf = await pdfjsLib.getDocument({
      data: pdfBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const numPages = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;
    const images: PDFPageImage[] = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      // Create canvas
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d')!;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      // Convert to PNG base64
      const imageData = canvas.toDataURL('image/png').split(',')[1];

      images.push({
        pageNumber: pageNum,
        imageData,
        width: viewport.width,
        height: viewport.height,
      });
    }

    return images;
  } catch (error) {
    console.error('Error converting PDF to images:', error);
    throw new Error('Failed to convert PDF to images');
  }
}

export async function convertPDFPageToImage(
  pdfBuffer: ArrayBuffer,
  pageNumber: number,
  scale = 2
): Promise<PDFPageImage> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d')!;

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    const imageData = canvas.toDataURL('image/png').split(',')[1];

    return {
      pageNumber,
      imageData,
      width: viewport.width,
      height: viewport.height,
    };
  } catch (error) {
    console.error('Error converting PDF page to image:', error);
    throw new Error('Failed to convert PDF page to image');
  }
}

export async function getPDFPageCount(pdfBuffer: ArrayBuffer): Promise<number> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    return pdf.numPages;
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    throw new Error('Failed to get PDF page count');
  }
}

function createCanvas(width: number, height: number): any {
  if (typeof window !== 'undefined') {
    // Browser environment
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  } else {
    // Node.js environment - try @napi-rs/canvas first, fallback to canvas
    try {
      const { createCanvas: napiCreateCanvas } = require('@napi-rs/canvas');
      return napiCreateCanvas(width, height);
    } catch (e) {
      console.log('Falling back to node-canvas');
      const { createCanvas: nodeCreateCanvas } = require('canvas');
      return nodeCreateCanvas(width, height);
    }
  }
}
