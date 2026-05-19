/**
 * Crop a region from a PDF page defined by a trace polygon.
 * Renders the full page, then extracts the bounding box of the trace.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { getLocalPdfWorkerSrc } from '@/lib/pdf/pdfjs-worker';
import type { Trace } from '@/lib/types/takeoff';

pdfjsLib.GlobalWorkerOptions.workerSrc = getLocalPdfWorkerSrc();

interface CropResult {
  imageBase64: string;
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * Crop the bounding box of a trace from a PDF page.
 * Renders the full page at target DPI, then extracts the crop region.
 */
export async function cropTraceRegion(
  pdfUrl: string,
  pageNumber: number,
  trace: Trace,
  padding: number = 20,
  targetDpi: number = 150,
): Promise<CropResult> {
  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  const page = await pdf.getPage(pageNumber);
  const renderScale = targetDpi / 72;
  const fullVp = page.getViewport({ scale: renderScale });

  // Render full page to an offscreen canvas
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.round(fullVp.width);
  fullCanvas.height = Math.round(fullVp.height);
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) throw new Error('Could not get canvas context');

  await page.render({ canvasContext: fullCtx, viewport: fullVp }).promise;

  // Compute bounding box of trace points (in base PDF coords, Y-down)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of trace.points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }

  // Add padding and clamp to page bounds (in base PDF coords)
  const baseVp = page.getViewport({ scale: 1.0 });
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(baseVp.width, maxX + padding);
  maxY = Math.min(baseVp.height, maxY + padding);

  const cropWidth = maxX - minX;
  const cropHeight = maxY - minY;

  // Scale crop coordinates to rendered pixel coords
  const sx = Math.round(minX * renderScale);
  const sy = Math.round(minY * renderScale);
  const sw = Math.round(cropWidth * renderScale);
  const sh = Math.round(cropHeight * renderScale);

  // Extract the crop region to a new canvas
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) throw new Error('Could not get crop canvas context');

  cropCtx.fillStyle = '#ffffff';
  cropCtx.fillRect(0, 0, sw, sh);

  const canMaskToPolygon = trace.isClosed && trace.points.length >= 3;
  if (canMaskToPolygon) {
    cropCtx.save();
    cropCtx.beginPath();
    trace.points.forEach((point, index) => {
      const cropX = (point.x - minX) * renderScale;
      const cropY = (point.y - minY) * renderScale;
      if (index === 0) {
        cropCtx.moveTo(cropX, cropY);
      } else {
        cropCtx.lineTo(cropX, cropY);
      }
    });
    cropCtx.closePath();
    cropCtx.clip();
  }

  cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  if (canMaskToPolygon) {
    cropCtx.restore();
  }

  // Convert to JPEG base64
  const dataUrl = cropCanvas.toDataURL('image/jpeg', 0.85);
  const imageBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

  return {
    imageBase64,
    bbox: { x: minX, y: minY, width: cropWidth, height: cropHeight },
  };
}
