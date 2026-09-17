"use client";

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  StretchHorizontal,
  StretchVertical,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;
// The scrollable page container's own padding (p-4 = 1rem = 16px, both sides) — subtracted
// before fitting a page to it so "fit width/height" doesn't run the page edge under the frame.
const CONTAINER_PADDING_PX = 32;

type FitMode = "width" | "height" | "custom";

type PageEntry = { pageNumber: number; canvas: HTMLCanvasElement | null; rendered: boolean };

// specs/05-level-1-structure.md: "our own viewer component, no Paperless frontend code" —
// PDF.js (the same rendering engine paperless-ngx's own preview uses) instead of the native
// <object> plugin the previous version used. The plugin had no loading state (looked frozen
// until the whole file finished transferring) and rendered with each browser's own inconsistent
// default UI. This renders only the first page eagerly and lazy-renders the rest as they
// scroll into view (IntersectionObserver), which is what actually fixes "takes too long" for
// multi-page documents — Paperless's pinned version doesn't honor HTTP Range requests at all
// (confirmed live), so there's no server-side fix available; the win has to come from not
// paying full-document render cost up front.
export function PdfJsViewer({ documentId, title }: { documentId: string; title: string }) {
  const previewUrl = `/api/documents/${documentId}/preview`;
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  // "Fit to width" by default (per user ask) — recomputed on load and whenever the container
  // resizes (the split-view squeeze from the layout change makes this matter: without it,
  // resizing the window would leave a stale scale sized for the old container width). Manually
  // zooming with +/- switches to "custom" and stops auto-recomputing until fit-width/height is
  // clicked again.
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [currentPage, setCurrentPage] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported" | "error">("loading");
  const renderedPages = useRef<Set<number>>(new Set());
  const renderTokens = useRef(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      try {
        const loadingTask = pdfjsLib.getDocument({ url: previewUrl, withCredentials: true });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        // Cleanup already destroyed this exact task (and cleared the ref) if we were
        // unmounted/superseded mid-load — nothing left to do.
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        setStatus("ready");
      } catch {
        // Not a real PDF (a plain-text preview, an unarchived image, etc.) — the iframe
        // fallback below renders whatever content-type the preview route actually returns.
        if (!cancelled) setStatus("unsupported");
      }
    })();

    // Deliberately one effect, not split into a second `[pdf]`-keyed cleanup effect — a
    // second effect's cleanup fires on every dependency change, not just unmount, and `pdf`
    // itself changes the instant the document finishes loading (null -> doc), which destroyed
    // the loading task the moment it became usable ("Cannot read properties of null (reading
    // 'sendWithPromise')" — found live). This only tears down on unmount or a real
    // documentId change, which is the actual intent.
    return () => {
      cancelled = true;
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewUrl is derived from documentId, stable per mount
  }, [documentId]);

  // pageNumber -> the render token it's currently in flight for. A plain Set here originally
  // caused a real bug: fit-width/fit-height changes scale (and the token) shortly after the
  // initial load, and if the *old* scale's render() was still in flight when that happened, the
  // new-scale render got skipped as "already rendering" — the old render then finished, saw its
  // token was stale, and quietly dropped its own result too, leaving the page with no canvas at
  // all. Keyed by token, a newer render is never blocked by an older one still finishing.
  const renderingPages = useRef<Map<number, number>>(new Map());

  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!pdf) return;
      const token = renderTokens.current;
      if (renderedPages.current.has(pageNumber)) return;
      if (renderingPages.current.get(pageNumber) === token) return; // already in flight for this exact token
      const container = pageRefs.current.get(pageNumber);
      if (!container) return;

      renderingPages.current.set(pageNumber, token);
      try {
        const page = await pdf.getPage(pageNumber);
        if (token !== renderTokens.current) return; // scale changed mid-fetch — stale

        const viewport = page.getViewport({ scale });
        let canvas = container.querySelector("canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          container.appendChild(canvas);
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (token === renderTokens.current) renderedPages.current.add(pageNumber);
      } finally {
        // Only clear our own token's marker — a newer render may have already claimed this
        // page number by the time we get here.
        if (renderingPages.current.get(pageNumber) === token) {
          renderingPages.current.delete(pageNumber);
        }
      }
    },
    [pdf, scale]
  );

  // Drives "fit width"/"fit height": measured off page 1's native size against the current
  // container size, re-run on every resize (ResizeObserver) while a fit mode is active — the
  // squeeze/stack responsive behavior means the container's own size genuinely changes as the
  // window resizes, not just on first load.
  useEffect(() => {
    if (fitMode === "custom" || status !== "ready" || !pdf || !containerRef.current) return;
    let cancelled = false;

    async function apply() {
      if (!pdf || !containerRef.current) return;
      const page = await pdf.getPage(1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1 });
      const availableWidth = containerRef.current.clientWidth - CONTAINER_PADDING_PX;
      const availableHeight = containerRef.current.clientHeight - CONTAINER_PADDING_PX;
      const raw =
        fitMode === "width" ? availableWidth / viewport.width : availableHeight / viewport.height;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)));
    }

    void apply();
    const el = containerRef.current;
    const observer = new ResizeObserver(() => void apply());
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [fitMode, status, pdf]);

  // Scale change invalidates every already-rendered canvas — bump the token so any in-flight
  // render() from the old scale is ignored when it resolves, and clear the rendered-set so
  // visible pages redraw at the new size.
  useEffect(() => {
    renderTokens.current += 1;
    renderedPages.current.clear();
    if (status !== "ready") return;
    for (const el of pageRefs.current.values()) {
      const existingCanvas = el.querySelector("canvas");
      existingCanvas?.remove();
    }
    // Re-render whatever's currently visible immediately; the observer below handles the rest.
    const visible = [...pageRefs.current.entries()].filter(([, el]) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    });
    for (const [pageNumber] of visible) void renderPage(pageNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally scale-only; renderPage is stable enough here
  }, [scale, status]);

  useEffect(() => {
    if (status !== "ready" || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNumber = Number((entry.target as HTMLElement).dataset.page);
          if (pageNumber) void renderPage(pageNumber);
        }
      },
      { root: containerRef.current, rootMargin: "600px 0px" }
    );
    for (const el of pageRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [status, numPages, renderPage]);

  // Tracks which page is centered in view for the toolbar's page indicator, independent of
  // which pages have actually been rendered.
  useEffect(() => {
    if (status !== "ready" || !containerRef.current) return;
    const root = containerRef.current;
    function onScroll() {
      const rootRect = root.getBoundingClientRect();
      const center = rootRect.top + rootRect.height / 2;
      let closest = 1;
      let closestDistance = Infinity;
      for (const [pageNumber, el] of pageRefs.current.entries()) {
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = pageNumber;
        }
      }
      setCurrentPage(closest);
    }
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [status]);

  const pages = useMemo<PageEntry[]>(
    () => Array.from({ length: numPages }, (_, i) => ({ pageNumber: i + 1, canvas: null, rendered: false })),
    [numPages]
  );

  function goToPage(pageNumber: number) {
    const el = pageRefs.current.get(pageNumber);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (status === "unsupported" || status === "error") {
    return (
      <iframe
        className="h-[80vh] w-full rounded-lg border border-border bg-panel-strong lg:h-full"
        src={previewUrl}
        title={title}
      />
    );
  }

  return (
    <div className="flex h-[80vh] min-w-0 flex-col gap-2 lg:h-full">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-panel px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            disabled={status !== "ready" || currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-sm text-muted">
            {status === "ready" ? `${currentPage} / ${numPages}` : "…"}
          </span>
          <Button
            disabled={status !== "ready" || currentPage >= numPages}
            onClick={() => goToPage(currentPage + 1)}
            size="icon"
            variant="ghost"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Fit width"
            aria-pressed={fitMode === "width"}
            className="data-[active=true]:bg-panel-strong data-[active=true]:text-foreground"
            data-active={fitMode === "width"}
            disabled={status !== "ready"}
            onClick={() => setFitMode("width")}
            size="icon"
            variant="ghost"
          >
            <StretchHorizontal className="size-4" />
          </Button>
          <Button
            aria-label="Fit height"
            aria-pressed={fitMode === "height"}
            className="data-[active=true]:bg-panel-strong data-[active=true]:text-foreground"
            data-active={fitMode === "height"}
            disabled={status !== "ready"}
            onClick={() => setFitMode("height")}
            size="icon"
            variant="ghost"
          >
            <StretchVertical className="size-4" />
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button
            disabled={scale <= MIN_SCALE}
            onClick={() => {
              setFitMode("custom");
              setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2)));
            }}
            size="icon"
            variant="ghost"
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="min-w-12 text-center text-sm text-muted">{Math.round(scale * 100)}%</span>
          <Button
            disabled={scale >= MAX_SCALE}
            onClick={() => {
              setFitMode("custom");
              setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2)));
            }}
            size="icon"
            variant="ghost"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-panel-strong/40"
        ref={containerRef}
      >
        {status === "loading" ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 aria-label="Loading" className="size-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 p-4">
            {pages.map(({ pageNumber }) => (
              <div
                className="bg-white shadow-sm"
                data-page={pageNumber}
                key={pageNumber}
                ref={(el) => {
                  if (el) pageRefs.current.set(pageNumber, el);
                  else pageRefs.current.delete(pageNumber);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
