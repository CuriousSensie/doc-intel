"use client";

import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";

const DOCUMENT_PAGE_SIZES = [10, 25, 50] as const;
type DocumentPageSize = (typeof DOCUMENT_PAGE_SIZES)[number];

function pageWindow(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  if (page <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (page >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  const ordered = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  for (const item of ordered) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && item - previous > 1) result.push("ellipsis");
    result.push(item);
  }
  return result;
}

export function DocumentsPagination({
  page,
  pageSize,
  totalCount,
  totalPages
}: {
  page: number;
  pageSize: DocumentPageSize;
  totalCount: number;
  totalPages: number;
}) {
  const t = useTranslations("documents.list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalCount === 0) return null;

  function goToPage(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    if (nextPage <= 1) params.delete("page");
    else params.set("page", String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  function setPageSize(nextPageSize: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("cursor");
    params.delete("page");
    if (Number(nextPageSize) === 25) params.delete("pageSize");
    else params.set("pageSize", nextPageSize);
    router.push(`${pathname}?${params.toString()}`);
  }

  const canGoBack = page > 1;
  const canGoForward = totalPages > 0 && page < totalPages;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel px-3 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        <span>
          {t("paginationSummary", { page, totalPages: Math.max(totalPages, 1), totalCount })}
        </span>
        <Select onValueChange={setPageSize} value={String(pageSize)}>
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOCUMENT_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("pageSize", { count: size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Pagination className="mx-0 w-auto justify-start sm:justify-end">
        <PaginationContent className="flex-wrap">
          <PaginationItem>
            <Button
              aria-label={t("firstPage")}
              disabled={!canGoBack}
              onClick={() => goToPage(1)}
              size="icon"
              variant="outline"
            >
              <ChevronsLeft aria-hidden="true" className="size-4" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              aria-label={t("previousPage")}
              disabled={!canGoBack}
              onClick={() => goToPage(page - 1)}
              size="icon"
              variant="outline"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Button>
          </PaginationItem>

          {pageWindow(page, totalPages).map((item, index) =>
            item === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <Button
                  aria-current={item === page ? "page" : undefined}
                  onClick={() => goToPage(item)}
                  size="icon"
                  variant={item === page ? "default" : "ghost"}
                >
                  {item}
                </Button>
              </PaginationItem>
            )
          )}

          <PaginationItem>
            <Button
              aria-label={t("nextPage")}
              disabled={!canGoForward}
              onClick={() => goToPage(page + 1)}
              size="icon"
              variant="outline"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              aria-label={t("lastPage")}
              disabled={!canGoForward}
              onClick={() => goToPage(totalPages)}
              size="icon"
              variant="outline"
            >
              <ChevronsRight aria-hidden="true" className="size-4" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
