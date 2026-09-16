"use client";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  Columns3,
  LayoutGrid,
  Rows3,
  Search,
  Table2,
  X
} from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { PaperlessCorrespondent, PaperlessTag } from "@/lib/paperless/documents";
import type { DocumentListField } from "@/modules/documents/documents.schemas";
import type { DocumentSort, DocumentSortDirection } from "@/modules/documents/documents.service";

export type DocumentsViewMode = "list" | "smallCards" | "largeCards";

type FilterOptions = {
  tags: PaperlessTag[];
  correspondents: PaperlessCorrespondent[];
  // Pre-slugified server-side (toDocumentTypeKey()) so the option value matches
  // documents.document_type_key exactly — never the raw Paperless name.
  documentTypes: Array<{ key: string; name: string }>;
};

type Props = {
  filterOptions: FilterOptions;
  selectedEntity: { id: string; label: string } | null;
  current: {
    q?: string;
    titleOnly?: boolean;
    tagIds?: number[];
    correspondentId?: number;
    documentTypeKey?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    hasNoConnections?: boolean;
    sort?: DocumentSort;
    sortDirection?: DocumentSortDirection;
    view?: DocumentsViewMode;
    fields?: DocumentListField[];
  };
};

const STATUS_VALUES = ["pending", "processing", "ready", "failed", "orphaned"] as const;
const FIELD_VALUES: DocumentListField[] = [
  "title",
  "tags",
  "correspondent",
  "documentType",
  "connections",
  "pages",
  "createdAt"
];

export function DocumentsFilterBar({ filterOptions, selectedEntity, current }: Props) {
  const t = useTranslations("documents.filters");
  const tList = useTranslations("documents.list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(current.q ?? "");

  function navigate(mutate: (params: URLSearchParams) => void, resetCursor = true) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    if (resetCursor) params.delete("cursor");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function setOrDelete(params: URLSearchParams, key: string, value: string | null) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  function toggleTag(tagId: number) {
    const next = new Set(current.tagIds ?? []);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    navigate((params) => setOrDelete(params, "tagIds", next.size ? [...next].join(",") : null));
  }

  function toggleField(field: DocumentListField) {
    const next = new Set(current.fields ?? FIELD_VALUES);
    if (next.has(field) && next.size > 1) next.delete(field);
    else next.add(field);
    navigate(
      (params) => setOrDelete(params, "fields", FIELD_VALUES.filter((f) => next.has(f)).join(",")),
      false
    );
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchValue.trim();
      if (next === (current.q ?? "")) return;
      navigate((params) => setOrDelete(params, "q", next || null));
    }, 350);

    return () => clearTimeout(handle);
    // searchParams is intentionally excluded; current.q changes after navigation and is the
    // stable comparison point for this debounced URL sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue, current.q]);

  const activeTagCount = current.tagIds?.length ?? 0;
  const hasAnyFilter = Boolean(
    current.q ||
    activeTagCount ||
    current.correspondentId ||
    current.documentTypeKey ||
    current.status ||
    current.dateFrom ||
    current.dateTo ||
    current.hasNoConnections ||
    selectedEntity
  );

  return (
    <section
      className="grid gap-4 rounded-lg border border-border bg-panel p-4 shadow-sm"
      data-pending={isPending}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-3xl font-black">{tList("title")}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            onValueChange={(value) => navigate((params) => setOrDelete(params, "sort", value))}
            value={current.sort ?? "created"}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">{t("sortTitle")}</SelectItem>
              <SelectItem value="created">{t("sortCreated")}</SelectItem>
              <SelectItem value="mimeType">{t("sortMimeType")}</SelectItem>
              <SelectItem value="size">{t("sortSize")}</SelectItem>
              <SelectItem value="pages">{t("sortPages")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            aria-label={t("sortDirection")}
            onClick={() =>
              navigate((params) =>
                setOrDelete(params, "sortDirection", current.sortDirection === "asc" ? null : "asc")
              )
            }
            size="icon"
            variant="outline"
          >
            {current.sortDirection === "asc" ? (
              <ArrowUpAZ className="size-4" />
            ) : (
              <ArrowDownAZ className="size-4" />
            )}
          </Button>

          <div className="flex items-center overflow-hidden rounded-md border border-border">
            {(
              [
                { mode: "list", icon: Table2, label: t("viewTable") },
                { mode: "smallCards", icon: LayoutGrid, label: t("viewSmallCards") },
                { mode: "largeCards", icon: Rows3, label: t("viewLargeCards") }
              ] as const
            ).map(({ mode, icon: Icon, label }) => (
              <button
                aria-label={label}
                aria-pressed={(current.view ?? "list") === mode}
                className="flex size-10 items-center justify-center border-r border-border text-muted last:border-r-0 hover:bg-panel-strong data-[active=true]:bg-panel-strong data-[active=true]:text-foreground"
                data-active={(current.view ?? "list") === mode}
                key={mode}
                onClick={() =>
                  navigate(
                    (params) => setOrDelete(params, "view", mode === "list" ? null : mode),
                    false
                  )
                }
                type="button"
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("fields")} size="icon" variant="outline">
                <Columns3 className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("fields")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {FIELD_VALUES.map((field) => (
                <DropdownMenuCheckboxItem
                  checked={(current.fields ?? FIELD_VALUES).includes(field)}
                  key={field}
                  onCheckedChange={() => toggleField(field)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {t(`field_${field}`)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-64 flex-1 items-center gap-2 xl:max-w-3xl">
          <Search className="size-4 shrink-0 text-muted" />
          <Input
            className="flex-1"
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            value={searchValue}
          />
          <Select
            onValueChange={(value) =>
              navigate((params) =>
                setOrDelete(params, "titleOnly", value === "title" ? "true" : null)
              )
            }
            value={current.titleOnly ? "title" : "all"}
          >
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("searchModeAll")}</SelectItem>
              <SelectItem value="title">{t("searchModeTitle")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                {t("tags")}
                {activeTagCount > 0 ? ` (${activeTagCount})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-auto">
              <DropdownMenuLabel>{t("tags")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.tags.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted">{t("noTags")}</p>
              ) : (
                filterOptions.tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    checked={current.tagIds?.includes(tag.id) ?? false}
                    key={tag.id}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select
            onValueChange={(value) =>
              navigate((params) =>
                setOrDelete(params, "correspondentId", value === "all" ? null : value)
              )
            }
            value={current.correspondentId ? String(current.correspondentId) : "all"}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("correspondent")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allCorrespondents")}</SelectItem>
              {filterOptions.correspondents.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              navigate((params) => setOrDelete(params, "status", value === "all" ? null : value))
            }
            value={current.status ?? "all"}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder={t("status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              {STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              navigate((params) =>
                setOrDelete(params, "documentTypeKey", value === "all" ? null : value)
              )
            }
            value={current.documentTypeKey ?? "all"}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t("documentType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allDocumentTypes")}</SelectItem>
              {filterOptions.documentTypes.map((dt) => (
                <SelectItem key={dt.key} value={dt.key}>
                  {dt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <CalendarDays className="size-4" />
                {t("createdAt")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-3">
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs font-semibold text-muted">
                  {t("dateFrom")}
                  <Input
                    defaultValue={current.dateFrom ?? ""}
                    onChange={(e) =>
                      navigate((params) => setOrDelete(params, "dateFrom", e.target.value || null))
                    }
                    type="date"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-muted">
                  {t("dateTo")}
                  <Input
                    defaultValue={current.dateTo ?? ""}
                    onChange={(e) =>
                      navigate((params) => setOrDelete(params, "dateTo", e.target.value || null))
                    }
                    type="date"
                  />
                </label>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={() =>
              navigate((params) =>
                setOrDelete(params, "hasNoConnections", current.hasNoConnections ? null : "true")
              )
            }
            variant={current.hasNoConnections ? "default" : "outline"}
          >
            {t("hasNoConnections")}
          </Button>

          {selectedEntity ? (
            <Button
              onClick={() =>
                navigate((params) => {
                  params.delete("entityId");
                })
              }
              variant="default"
            >
              {selectedEntity.label}
              <X className="size-3.5" />
            </Button>
          ) : null}

          {hasAnyFilter ? (
            <Button onClick={() => startTransition(() => router.push(pathname))} variant="ghost">
              {t("clearAll")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
