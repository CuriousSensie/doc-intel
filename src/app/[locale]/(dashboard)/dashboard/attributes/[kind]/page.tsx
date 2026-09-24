import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AttributesTable } from "@/components/attributes/attributes-table";
import { CustomFieldForm } from "@/components/attributes/custom-field-form";
import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  attributeKindSchema,
  type CustomFieldDataType,
  type MatchingAlgorithm
} from "@/modules/attributes/attributes.schemas";
import { saveAttributeFormAction } from "@/modules/attributes/attributes.actions";
import { listAttributes, type AttributeRow } from "@/modules/attributes/attributes.service";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { buildRequestContext } from "@/lib/service-context";
import { paperlessFor } from "@/lib/paperless/client";
import { toDocumentTypeKey } from "@/lib/paperless/documents";
import { getCachedDocumentTypes } from "@/lib/paperless/metadata-cache";

export const dynamic = "force-dynamic";

const titleKeys = {
  tags: "tagsTitle",
  correspondents: "correspondentsTitle",
  "document-types": "documentTypesTitle",
  "custom-fields": "customFieldsTitle"
} as const;

const matchingAlgorithms: MatchingAlgorithm[] = ["none", "any", "all", "exact", "regex", "fuzzy"];

const controlClass =
  "min-h-10 w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50";

function AttributeForm({
  kind,
  editing,
  labels,
  matchingLabels,
  dataTypeLabels,
  documentTypeOptions,
  cancelControl
}: {
  kind: keyof typeof titleKeys;
  editing?: AttributeRow;
  labels: {
    title: string;
    description: string;
    name: string;
    color: string;
    matchingAlgorithm: string;
    match: string;
    create: string;
    save: string;
    cancel: string;
    dataType: string;
    dataTypeImmutableHint: string;
    options: string;
    optionsHint: string;
    optionPlaceholder: string;
    addOption: string;
    removeOption: string;
    scope: string;
    scopeGlobal: string;
    scopeGlobalHint: string;
    scopeDocumentTypes: string;
    documentTypesSearchPlaceholder: string;
    documentTypesEmpty: string;
  };
  matchingLabels: Record<MatchingAlgorithm, string>;
  dataTypeLabels: Record<CustomFieldDataType, string>;
  documentTypeOptions: Array<{ key: string; name: string }>;
  cancelControl: React.ReactNode;
}) {
  const isTag = kind === "tags";

  if (kind === "custom-fields") {
    return (
      <CustomFieldForm
        action={saveAttributeFormAction}
        cancelControl={cancelControl}
        dataTypeLabels={dataTypeLabels}
        documentTypeOptions={documentTypeOptions}
        editing={editing}
        labels={labels}
      />
    );
  }

  return (
    <form action={saveAttributeFormAction} className="grid gap-4">
      <input name="kind" type="hidden" value={kind} />
      {editing ? <input name="id" type="hidden" value={editing.id} /> : null}
      <div className={`grid gap-4 ${isTag ? "md:grid-cols-[minmax(0,1fr)_10rem]" : ""}`}>
        <label className="grid gap-1.5 text-sm font-medium">
          <span>{labels.name}</span>
          <Input
            autoComplete="off"
            defaultValue={editing?.name}
            maxLength={128}
            name="name"
            required
          />
        </label>
        {isTag ? (
          <label className="grid gap-1.5 text-sm font-medium">
            <span>{labels.color}</span>
            <Input defaultValue={editing?.color ?? "#64748b"} name="color" type="color" />
          </label>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(13rem,18rem)_minmax(0,1fr)]">
        <label className="grid gap-1.5 text-sm font-medium">
          <span>{labels.matchingAlgorithm}</span>
          <select
            className={controlClass}
            defaultValue={editing?.matchingAlgorithm ?? "none"}
            name="matchingAlgorithm"
          >
            {matchingAlgorithms.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {matchingLabels[algorithm]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          <span>{labels.match}</span>
          <Input autoComplete="off" defaultValue={editing?.match} maxLength={256} name="match" />
        </label>
      </div>

      <DialogFooter>
        {cancelControl}
        <Button type="submit">{editing ? labels.save : labels.create}</Button>
      </DialogFooter>
    </form>
  );
}

export default async function AttributePage({
  params,
  searchParams
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ edit?: string; error?: string; message?: string }>;
}) {
  const [{ kind: rawKind }, search, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("common.attributes")
  ]);
  const parsedKind = attributeKindSchema.safeParse(rawKind);
  if (!parsedKind.success) notFound();

  const kind = parsedKind.data;
  requireFeature(kind === "custom-fields" ? "entities" : "documents");
  await requireUser(`/dashboard/attributes/${kind}`);

  const ctx = await buildRequestContext();
  const [attributes, documentTypeOptions] = await Promise.all([
    listAttributes(ctx, kind),
    kind === "custom-fields"
      ? paperlessFor(ctx.orgId).then(async (client) => {
          const documentTypes = await getCachedDocumentTypes(client, ctx.orgId);
          return documentTypes.map((dt) => ({ key: toDocumentTypeKey(dt.name), name: dt.name }));
        })
      : Promise.resolve([])
  ]);
  const editing = search.edit ? attributes.find((attribute) => attribute.id === search.edit) : undefined;
  const labels = {
    title: t("createTitle", { kind: t(titleKeys[kind]) }),
    description: kind === "custom-fields" ? t("customFieldFormDescription") : t("formDescription"),
    name: t("form.name"),
    color: t("form.color"),
    matchingAlgorithm: t("form.matchingAlgorithm"),
    match: t("form.match"),
    create: t("form.create"),
    save: t("form.save"),
    cancel: t("form.cancel"),
    dataType: t("form.dataType"),
    dataTypeImmutableHint: t("form.dataTypeImmutableHint"),
    options: t("form.options"),
    optionsHint: t("form.optionsHint"),
    optionPlaceholder: t("form.optionPlaceholder"),
    addOption: t("form.addOption"),
    removeOption: t("form.removeOption"),
    scope: t("form.scope"),
    scopeGlobal: t("form.scopeGlobal"),
    scopeGlobalHint: t("form.scopeGlobalHint"),
    scopeDocumentTypes: t("form.scopeDocumentTypes"),
    documentTypesSearchPlaceholder: t("form.documentTypesSearchPlaceholder"),
    documentTypesEmpty: t("form.documentTypesEmpty")
  };
  const matchingLabels = {
    none: t("matching.none.option"),
    any: t("matching.any.option"),
    all: t("matching.all.option"),
    exact: t("matching.exact.option"),
    regex: t("matching.regex.option"),
    fuzzy: t("matching.fuzzy.option")
  };
  const dataTypeLabels = {
    string: t("dataTypes.string"),
    integer: t("dataTypes.integer"),
    float: t("dataTypes.float"),
    monetary: t("dataTypes.monetary"),
    date: t("dataTypes.date"),
    boolean: t("dataTypes.boolean"),
    select: t("dataTypes.select"),
    documentlink: t("dataTypes.documentlink"),
    url: t("dataTypes.url")
  };

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{t(titleKeys[kind])}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t("description")}</p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button>{labels.create}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{labels.title}</DialogTitle>
              <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>
            <AttributeForm
              cancelControl={
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {labels.cancel}
                  </Button>
                </DialogClose>
              }
              dataTypeLabels={dataTypeLabels}
              documentTypeOptions={documentTypeOptions}
              kind={kind}
              labels={labels}
              matchingLabels={matchingLabels}
            />
          </DialogContent>
        </Dialog>
      </div>

      <FormMessage error={search.error} message={search.message} />

      {editing ? (
        <Dialog defaultOpen>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing.name}</DialogTitle>
              <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>
            <AttributeForm
              cancelControl={
                <Button asChild type="button" variant="outline">
                  <Link href={`/dashboard/attributes/${kind}`}>{labels.cancel}</Link>
                </Button>
              }
              dataTypeLabels={dataTypeLabels}
              documentTypeOptions={documentTypeOptions}
              editing={editing}
              kind={kind}
              labels={labels}
              matchingLabels={matchingLabels}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {attributes.length === 0 ? (
        <EmptyState description={t("emptyDescription")} title={t("emptyTitle")} />
      ) : (
        <AttributesTable attributes={attributes} documentTypeOptions={documentTypeOptions} kind={kind} />
      )}
    </div>
  );
}
