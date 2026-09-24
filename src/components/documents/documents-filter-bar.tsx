"use client";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  Columns3,
  FolderTree,
  LayoutGrid,
  Rows3,
  Search,
  Settings2,
  SlidersHorizontal,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SaveViewDialog } from "@/components/saved-views/save-view-dialog";
import type { PaperlessCorrespondent, PaperlessTag } from "@/lib/paperless/documents";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import type {
  DocumentListField,
  StaticDocumentListField
} from "@/modules/documents/documents.schemas";
import type { DocumentSort, DocumentSortDirection } from "@/modules/documents/documents.service";
import { DocumentUploadDialogButton } from "@/components/documents/document-upload-dialog-button";

export type DocumentsViewMode = "list" | "smallCards" | "largeCards" | "folders";

type FilterOptions = {
  tags: PaperlessTag[];
  correspondents: PaperlessCorrespondent[];
  // Pre-slugified server-side (toDocumentTypeKey()) so the option value matches
  // documents.document_type_key exactly — never the raw Paperless name.
  documentTypes: Array<{ key: string; name: string }>;
  customFields: CustomFieldDef[];
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
  // ADR-0019 Phase D — gates the "Upload folder" tab in DocumentUploadDialogButton; undefined/
  // false leaves the upload dialog exactly as it was before folders existed.
  foldersEnabled?: boolean;
};

const FIELD_VALUES: StaticDocumentListField[] = [
  "title",
  "tags",
  "correspondent",
  "documentType",
  "connections",
  "pages",
  "createdAt"
];

// Folders is a peer view mode (ADR-0019 explorer redesign), filtered out below when the folders
// feature flag is off — same gate as the "Upload folder" tab (foldersEnabled prop).
const VIEW_MODE_LABEL_KEYS = {
  list: "viewTable",
  smallCards: "viewSmallCards",
  largeCards: "viewLargeCards",
  folders: "viewFolders"
} as const;
const viewModeOptions: Array<{
  mode: DocumentsViewMode;
  icon: typeof Table2;
  labelKey: (typeof VIEW_MODE_LABEL_KEYS)[DocumentsViewMode];
}> = [
  { mode: "list", icon: Table2, labelKey: VIEW_MODE_LABEL_KEYS.list },
  { mode: "smallCards", icon: LayoutGrid, labelKey: VIEW_MODE_LABEL_KEYS.smallCards },
  { mode: "largeCards", icon: Rows3, labelKey: VIEW_MODE_LABEL_KEYS.largeCards },
  { mode: "folders", icon: FolderTree, labelKey: VIEW_MODE_LABEL_KEYS.folders }
];

export function DocumentsFilterBar({ filterOptions, selectedEntity, current, foldersEnabled }: Props) {
  const t = useTranslations("documents.filters");
  const tList = useTranslations("documents.list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(current.q ?? "");

  function navigate(mutate: (params: URLSearchParams) => void, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("cursor");
    if (resetPage) params.delete("page");
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
    navigate((params) => {
      const staticFields = FIELD_VALUES.filter((f) => next.has(f));
      const customFields = filterOptions.customFields
        .map((def) => `custom:${def.key}` as DocumentListField)
        .filter((fieldKey) => next.has(fieldKey));
      setOrDelete(params, "fields", [...staticFields, ...customFields].join(","));
    }, false);
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
  const selectedCorrespondent = filterOptions.correspondents.find(
    (c) => c.id === current.correspondentId
  );
  const selectedDocumentType = filterOptions.documentTypes.find(
    (dt) => dt.key === current.documentTypeKey
  );
  const hasAnyFilter = Boolean(
    current.q ||
    activeTagCount ||
    current.correspondentId ||
    current.documentTypeKey ||
    current.dateFrom ||
    current.dateTo ||
    current.hasNoConnections ||
    selectedEntity
  );
  const fields = current.fields ?? FIELD_VALUES;
  const fieldsChanged =
    fields.length !== FIELD_VALUES.length ||
    fields.some((field, index) => field !== FIELD_VALUES[index]);
  const hasSavableView = Boolean(
    hasAnyFilter ||
    current.sort ||
    current.sortDirection === "asc" ||
    (current.view && current.view !== "list") ||
    fieldsChanged
  );
  const savedViewFilters: Record<string, unknown> = {
    ...(current.q ? { q: current.q } : {}),
    ...(current.titleOnly ? { titleOnly: true } : {}),
    ...(current.tagIds?.length ? { tagIds: current.tagIds } : {}),
    ...(current.correspondentId ? { correspondentId: current.correspondentId } : {}),
    ...(current.documentTypeKey ? { documentTypeKey: current.documentTypeKey } : {}),
    ...(current.status ? { status: current.status } : {}),
    ...(current.dateFrom ? { dateFrom: current.dateFrom } : {}),
    ...(current.dateTo ? { dateTo: current.dateTo } : {}),
    ...(current.hasNoConnections ? { hasNoConnections: true } : {})
  };
  const savedViewSort: Record<string, unknown> = {
    sort: current.sort ?? "created",
    sortDirection: current.sortDirection ?? "desc",
    view: current.view ?? "list"
  };

  const listControls = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="justify-between" variant="outline">
            {current.sort === "title"
              ? t("sortTitle")
              : current.sort === "mimeType"
                ? t("sortMimeType")
                : current.sort === "size"
                  ? t("sortSize")
                  : current.sort === "pages"
                    ? t("sortPages")
                    : t("sortCreated")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            onValueChange={(value) => navigate((params) => setOrDelete(params, "sort", value))}
            value={current.sort ?? "created"}
          >
            <DropdownMenuRadioItem value="title">{t("sortTitle")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="created">{t("sortCreated")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="mimeType">{t("sortMimeType")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="size">{t("sortSize")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="pages">{t("sortPages")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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
        {viewModeOptions
          .filter(({ mode }) => mode !== "folders" || foldersEnabled)
          .map(({ mode, icon: Icon, labelKey }) => (
            <button
              aria-label={t(labelKey)}
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
          {filterOptions.customFields.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {filterOptions.customFields.map((def) => {
                const field = `custom:${def.key}` as DocumentListField;
                return (
                  <DropdownMenuCheckboxItem
                    checked={(current.fields ?? FIELD_VALUES).includes(field)}
                    key={def.id}
                    onCheckedChange={() => toggleField(field)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {def.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const filterControls = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="justify-between" variant="outline">
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
                onCheckedChange={() => toggleTag(tag.id)}
                onSelect={(e) => e.preventDefault()}
              >
                <span
                  className="mr-2 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="justify-between" variant="outline">
            {selectedCorrespondent?.name ?? t("allCorrespondents")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72 overflow-auto">
          <DropdownMenuLabel>{t("correspondent")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              navigate((params) =>
                setOrDelete(params, "correspondentId", value === "all" ? null : value)
              )
            }
            value={current.correspondentId ? String(current.correspondentId) : "all"}
          >
            <DropdownMenuRadioItem value="all">{t("allCorrespondents")}</DropdownMenuRadioItem>
            {filterOptions.correspondents.map((c) => (
              <DropdownMenuRadioItem key={c.id} value={String(c.id)}>
                {c.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="justify-between" variant="outline">
            {selectedDocumentType?.name ?? t("allDocumentTypes")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72 overflow-auto">
          <DropdownMenuLabel>{t("documentType")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              navigate((params) =>
                setOrDelete(params, "documentTypeKey", value === "all" ? null : value)
              )
            }
            value={current.documentTypeKey ?? "all"}
          >
            <DropdownMenuRadioItem value="all">{t("allDocumentTypes")}</DropdownMenuRadioItem>
            {filterOptions.documentTypes.map((dt) => (
              <DropdownMenuRadioItem key={dt.key} value={dt.key}>
                {dt.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );

  return (
    <section
      className="grid min-w-0 gap-4 rounded-lg border border-border bg-panel p-4 shadow-sm"
      data-pending={isPending}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap justify-between gap-3 md:justify-start">
          <h1 className="text-3xl font-black">{tList("title")}</h1>
          {hasSavableView ? (
            <SaveViewDialog
              buttonLabel={tList("saveView")}
              columns={fields}
              description={tList("saveViewDescription")}
              filters={savedViewFilters}
              sort={savedViewSort}
              viewKind="dynamic"
            />
          ) : null}
          <DocumentUploadDialogButton foldersEnabled={foldersEnabled} />
        </div>
        <div className="hidden flex-wrap items-center gap-2 xl:flex">{listControls}</div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2 xl:max-w-3xl">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("searchOptions")} size="icon" variant="ghost">
                <Settings2 className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t("searchOptions")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  navigate((params) =>
                    setOrDelete(params, "titleOnly", value === "title" ? "true" : null)
                  )
                }
                value={current.titleOnly ? "title" : "all"}
              >
                <DropdownMenuRadioItem value="all">{t("searchModeAll")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="title">{t("searchModeTitle")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            className="flex-1"
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("searchPlaceholder")}
            value={searchValue}
          />
          <Search className="size-4 shrink-0 text-muted" />
        </div>

        <div className="hidden flex-wrap items-center gap-2 xl:flex">{filterControls}</div>

        <Sheet>
          <SheetTrigger asChild>
            <Button className="xl:hidden" variant="outline">
              <SlidersHorizontal className="size-4" />
              {t("options")}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md" side="right">
            <SheetHeader>
              <SheetTitle>{t("options")}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-4 [&_button.justify-between]:w-full">
              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("listingOptions")}
                </p>
                <div className="grid gap-2">{listControls}</div>
              </div>
              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("filters")}
                </p>
                {filterControls}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </section>
  );
}
