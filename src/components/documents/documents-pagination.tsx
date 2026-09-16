"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";

import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";

// Keyset (cursor) pagination, not numbered pages — there's no cheap "jump to page N" over a
// cursor-paginated query, only "next" (nextCursor from the service) and "previous" (the
// browser's own history, since every "next" click is a router.push that already added a history
// entry — this only works if the visitor arrived at the current cursor via our own Next button,
// which is the only way to reach a non-empty cursor in the first place). Plain Button, not the
// ui/pagination.tsx PaginationPrevious/Next primitives — those hardcode English "Previous"/
// "Next" text regardless of children, which would break the sl locale.
export function DocumentsPagination({
  nextCursor,
  hasCursor
}: {
  nextCursor: string | null;
  hasCursor: boolean;
}) {
  const t = useTranslations("documents.list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!nextCursor && !hasCursor) return null;

  function goNext() {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("cursor", nextCursor);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Pagination>
      <PaginationContent>
        {hasCursor ? (
          <PaginationItem>
            <Button onClick={() => router.back()} variant="outline">
              <ChevronLeft aria-hidden="true" className="size-4" />
              {t("previousPage")}
            </Button>
          </PaginationItem>
        ) : null}
        {nextCursor ? (
          <PaginationItem>
            <Button onClick={goNext} variant="outline">
              {t("nextPage")}
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </PaginationItem>
        ) : null}
      </PaginationContent>
    </Pagination>
  );
}
