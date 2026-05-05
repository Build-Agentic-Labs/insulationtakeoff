"use client";

import { ChangeEvent, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  ChevronRight,
  FileUp,
  Layers3,
  Minus,
  Plus,
  RotateCw,
  FileText,
} from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const ZOOM_PRESETS = [0.75, 1, 1.5, 2];

export function ReactPdfRawTest() {
  const [file, setFile] = useState<File | null>(null);
  const [fileLabel, setFileLabel] = useState("No PDF selected");
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [renderTextLayer, setRenderTextLayer] = useState(true);
  const [renderAnnotationLayer, setRenderAnnotationLayer] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      return;
    }

    setFile(nextFile);
    setFileLabel(nextFile.name);
    setNumPages(0);
    setPageNumber(1);
    setScale(1);
    setRotation(0);
    setError(null);
  }

  function handleDocumentLoadSuccess({ numPages: nextNumPages }: { numPages: number }) {
    setNumPages(nextNumPages);
    setPageNumber(1);
    setError(null);
  }

  function handleDocumentLoadError(nextError: Error) {
    console.error("react-pdf test load error", nextError);
    setError(nextError.message || "Failed to load PDF");
  }

  function changePage(offset: number) {
    setPageNumber((currentPage) => {
      const nextPage = currentPage + offset;
      return Math.min(Math.max(nextPage, 1), numPages || 1);
    });
  }

  function changeScale(offset: number) {
    setScale((currentScale) => {
      const nextScale = Number((currentScale + offset).toFixed(2));
      return Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE);
    });
  }

  function jumpToPage(rawValue: string) {
    const nextPage = Number(rawValue);

    if (!Number.isFinite(nextPage)) {
      return;
    }

    setPageNumber(Math.min(Math.max(nextPage, 1), numPages || 1));
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4 p-4 xl:p-6">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-500">
            React PDF Lab
          </p>
          <h1 className="text-3xl font-semibold text-zinc-950">Raw `react-pdf` upload test</h1>
          <p className="max-w-3xl text-sm leading-6 text-zinc-600">
            This page uses a plain `Document` + `Page` setup so you can judge native upload,
            zoom, text clarity, and page switching without the takeoff overlays.
          </p>
        </div>

        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="p-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label
                  htmlFor="react-pdf-upload"
                  className="text-xs uppercase tracking-[0.18em] text-zinc-500"
                >
                  PDF Upload
                </Label>
                <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-4">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="rounded-lg bg-zinc-100 p-2 text-zinc-700">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900">{fileLabel}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Upload a local plan sheet or print PDF. The viewer stays raw so you can
                        judge `react-pdf` directly.
                      </p>
                    </div>
                  </div>
                  <Input
                    id="react-pdf-upload"
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="cursor-pointer bg-white"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-zinc-900">Viewer mode</p>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                  <span>Render text layer</span>
                  <input
                    type="checkbox"
                    checked={renderTextLayer}
                    onChange={(event) => setRenderTextLayer(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                  <span>Render annotation layer</span>
                  <input
                    type="checkbox"
                    checked={renderAnnotationLayer}
                    onChange={(event) => setRenderAnnotationLayer(event.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
                <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-3 text-sm text-zinc-600">
                  <div className="mb-2 flex items-center gap-2 font-medium text-zinc-800">
                    <Layers3 className="h-4 w-4" />
                    Evaluate
                  </div>
                  <ul className="space-y-1 leading-5">
                    <li>Text sharpness while zooming</li>
                    <li>Large-sheet page switching</li>
                    <li>Text/annotation layer impact</li>
                  </ul>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
                <p className="mb-2 font-medium text-zinc-900">Current state</p>
                <div className="space-y-1.5 font-mono text-xs text-zinc-500">
                  <p>page: {numPages ? `${pageNumber}/${numPages}` : "0/0"}</p>
                  <p>zoom: {Math.round(scale * 100)}%</p>
                  <p>rotation: {rotation} deg</p>
                  <p>text-layer: {renderTextLayer ? "on" : "off"}</p>
                  <p>annotation-layer: {renderAnnotationLayer ? "on" : "off"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div>
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="border-b border-zinc-200">
              <CardTitle>Viewer</CardTitle>
              <CardDescription>
                Raw `react-pdf` canvas render with optional text and annotation layers.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-b border-zinc-200 bg-white px-4 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700">
                      Page
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => changePage(-1)}
                        disabled={!file || pageNumber <= 1}
                        className="h-8 w-8 rounded-full"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={numPages || 1}
                        value={pageNumber}
                        onChange={(event) => jumpToPage(event.target.value)}
                        disabled={!file}
                        className="h-8 w-20 border-0 bg-transparent px-2 text-center shadow-none focus-visible:ring-0"
                      />
                      <span className="pr-2 text-sm text-zinc-500">of {numPages || 0}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => changePage(1)}
                        disabled={!file || pageNumber >= numPages}
                        className="h-8 w-8 rounded-full"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700">
                      Zoom {Math.round(scale * 100)}%
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => changeScale(-SCALE_STEP)}
                        disabled={scale <= MIN_SCALE}
                        className="h-8 w-8 rounded-full"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      {ZOOM_PRESETS.map((preset) => {
                        const isActive = Math.abs(scale - preset) < 0.01;

                        return (
                          <Button
                            key={preset}
                            type="button"
                            variant={isActive ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setScale(preset)}
                            className="h-8 rounded-full px-3"
                          >
                            {Math.round(preset * 100)}%
                          </Button>
                        );
                      })}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => changeScale(SCALE_STEP)}
                        disabled={scale >= MAX_SCALE}
                        className="h-8 w-8 rounded-full"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={renderTextLayer ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRenderTextLayer((current) => !current)}
                      className="rounded-full"
                    >
                      Text layer
                    </Button>
                    <Button
                      type="button"
                      variant={renderAnnotationLayer ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRenderAnnotationLayer((current) => !current)}
                      className="rounded-full"
                    >
                      Annotations
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRotation((currentRotation) => (currentRotation + 90) % 360)}
                      disabled={!file}
                      className="rounded-full"
                    >
                      <RotateCw className="h-4 w-4" />
                      Rotate
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setScale(1);
                        setRotation(0);
                      }}
                      className="rounded-full"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </div>
              <div className="h-[calc(100vh-12.5rem)] overflow-auto bg-zinc-200 p-4 xl:p-6">
                {!file ? (
                  <div className="flex h-full min-h-[32rem] items-center justify-center rounded-2xl border border-dashed border-zinc-400 bg-white/70 text-center">
                    <div className="space-y-3 px-8">
                      <p className="text-lg font-medium text-zinc-900">Upload a PDF to begin</p>
                      <p className="text-sm leading-6 text-zinc-600">
                        This route is isolated from the takeoff UI so you can judge `react-pdf`
                        on its own.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-full justify-center">
                    <Document
                      key={file.name}
                      file={file}
                      onLoadSuccess={handleDocumentLoadSuccess}
                      onLoadError={handleDocumentLoadError}
                      loading={
                        <div className="rounded-xl border border-zinc-300 bg-white px-6 py-10 text-sm text-zinc-600">
                          Loading PDF...
                        </div>
                      }
                      error={
                        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-sm text-red-700">
                          {error || "react-pdf could not render this file."}
                        </div>
                      }
                    >
                      <Page
                        pageNumber={pageNumber}
                        scale={scale}
                        rotate={rotation}
                        renderTextLayer={renderTextLayer}
                        renderAnnotationLayer={renderAnnotationLayer}
                      />
                    </Document>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
