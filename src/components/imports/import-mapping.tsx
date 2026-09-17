"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnPreview } from "@/lib/import/parse";
import { DATE_FORMATS, type DateFormat } from "@/lib/import/locale";
import { fieldSchemaArraySchema } from "@/modules/entities/field-schema";
import type { EntityType } from "@/modules/entity-types/entity-types.service";
import type { CustomFieldDef } from "@/modules/custom-fields/custom-field-defs.service";
import {
  mappingSchemaForKind,
  type ImportKind,
  type ImportMapping,
  type EntityImportMapping,
  type DocumentImportMapping,
  type EntityLinkMapping,
  type DocumentFieldMapping
} from "@/modules/imports/imports.schemas";
import { ColumnField, SelectField } from "./import-controls";
import { parsedExample } from "./import-utils";

type Props = {
  kind: ImportKind;
  columns: ColumnPreview[];
  entityTypes: EntityType[];
  customFields: CustomFieldDef[];
  initial: unknown;
  busy: boolean;
  onSubmit: (mapping: ImportMapping) => void;
};
function fieldsOf(type?: EntityType) {
  return fieldSchemaArraySchema.parse(type?.field_schema ?? []).filter((field) => !field.hidden);
}
function suggestedColumn(columns: ColumnPreview[], ...names: string[]) {
  return columns.find((column) =>
    names.some((name) => name.toLocaleLowerCase() === column.header.trim().toLocaleLowerCase())
  )?.index;
}
export function ImportMappingForm({
  kind,
  columns,
  entityTypes,
  customFields,
  initial,
  busy,
  onSubmit
}: Props) {
  const t = useTranslations("imports");
  const locale = useLocale();
  const parsed = mappingSchemaForKind(kind).safeParse(initial);
  const existing = parsed.success ? parsed.data : undefined;
  const [entity, setEntity] = useState<Partial<EntityImportMapping>>(
    kind === "entities" && existing
      ? (existing as EntityImportMapping)
      : {
          entityTypeKey: entityTypes[0]?.key ?? "",
          displayNameColumn: suggestedColumn(columns, "name", "display_name", "naziv", "ime"),
          identifierColumns: [],
          fields: []
        }
  );
  const [document, setDocument] = useState<DocumentImportMapping>(
    kind !== "entities" && existing
      ? {
          ...(existing as DocumentImportMapping),
          duplicateStrategy: (existing as DocumentImportMapping).duplicateStrategy ?? "skip"
        }
      : {
          documentBy: {
            strategy: "filename",
            column: suggestedColumn(columns, "filename", "file", "datoteka") ?? 0
          },
          entityLinks: [],
          fields: [],
          duplicateStrategy: "skip"
        }
  );
  const [error, setError] = useState("");
  const entityType = entityTypes.find((type) => type.key === entity.entityTypeKey);
  const entityFields = fieldsOf(entityType);
  const supportedCustomFields = customFields.filter(
    (field) =>
      field.paperless_custom_field_id != null &&
      ["string", "monetary", "decimal", "integer", "date", "boolean"].includes(field.data_type)
  );
  const defaults = {
    dateFormat: (locale === "sl" ? "dd.MM.yyyy" : "yyyy-MM-dd") as DateFormat,
    decimalSeparator: (locale === "sl" ? "," : ".") as "," | "."
  };

  function fieldOptions(
    field: { column: number; type: string; dateFormat?: DateFormat; decimalSeparator?: "," | "." },
    update: (patch: { dateFormat?: DateFormat; decimalSeparator?: "," | "." }) => void
  ) {
    if (!["date", "decimal", "monetary", "integer"].includes(field.type)) return null;
    let preview = "";
    let invalid = false;
    const raw = columns.find((column) => column.index === field.column)?.sample.find(Boolean) ?? "";
    try {
      preview = parsedExample(
        raw,
        field.type,
        field.dateFormat ?? defaults.dateFormat,
        field.decimalSeparator ?? defaults.decimalSeparator
      );
    } catch {
      invalid = true;
    }
    return (
      <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
        {field.type === "date" ? (
          <SelectField
            label={t("dateFormat")}
            value={field.dateFormat ?? defaults.dateFormat}
            onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}
          >
            {Object.keys(DATE_FORMATS).map((format) => (
              <option key={format}>{format}</option>
            ))}
          </SelectField>
        ) : (
          <SelectField
            label={t("decimalSeparator")}
            value={field.decimalSeparator ?? defaults.decimalSeparator}
            onChange={(e) => update({ decimalSeparator: e.target.value as "," | "." })}
          >
            <option value=",">{t("decimalComma")}</option>
            <option value=".">{t("decimalPoint")}</option>
          </SelectField>
        )}
        <p className={`break-words py-2 text-sm ${invalid ? "text-danger" : "text-muted"}`}>
          {raw ? `${raw} → ${invalid ? t("invalidExample") : preview}` : t("noExample")}
        </p>
      </div>
    );
  }
  function updateLink(index: number, patch: Partial<EntityLinkMapping>) {
    setDocument({
      ...document,
      entityLinks: document.entityLinks.map((link, i) =>
        i === index ? { ...link, ...patch } : link
      )
    });
  }
  return (
    <form
      className="grid gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const candidate = kind === "entities" ? entity : document;
        const result = mappingSchemaForKind(kind).safeParse(candidate);
        if (!result.success) {
          setError(t("mappingIncomplete"));
          return;
        }
        const refs =
          kind === "entities"
            ? [
                (result.data as EntityImportMapping).displayNameColumn,
                ...(result.data as EntityImportMapping).identifierColumns.map((f) => f.column),
                ...result.data.fields.map((f) => f.column)
              ]
            : [
                (result.data as DocumentImportMapping).documentBy.column,
                ...(result.data as DocumentImportMapping).entityLinks.map((f) => f.column),
                ...result.data.fields.map((f) => f.column)
              ];
        if (refs.some((ref) => !columns.some((column) => column.index === ref))) {
          setError(t("mappingColumnsChanged"));
          return;
        }
        setError("");
        onSubmit(result.data);
      }}
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-8">
        {kind === "entities" ? (
          <>
            {entityTypes.length === 0 && (
              <p role="alert" className="text-danger">
                {t("noEntityTypes")}
              </p>
            )}
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">{t("identifyEntities")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t("entityType")}
                  value={entity.entityTypeKey}
                  required
                  onChange={(e) =>
                    setEntity({
                      entityTypeKey: e.target.value,
                      displayNameColumn: entity.displayNameColumn,
                      fields: [],
                      identifierColumns: []
                    })
                  }
                >
                  <option value="">{t("chooseType")}</option>
                  {entityTypes.map((type) => (
                    <option value={type.key} key={type.key}>
                      {type.name_plural}
                    </option>
                  ))}
                </SelectField>
                <ColumnField
                  label={t("displayName")}
                  columns={columns}
                  required
                  value={entity.displayNameColumn}
                  onChange={(value) => setEntity({ ...entity, displayNameColumn: value })}
                />
              </div>
              <p className="max-w-prose text-sm text-muted">{t("identifierHelp")}</p>
              {entityFields.filter((field) => field.identifier_kind).length === 0 && (
                <p role="alert" className="text-danger">
                  {t("noIdentifiers")}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {entityFields
                  .filter((field) => field.identifier_kind)
                  .map((field) => (
                    <ColumnField
                      key={field.key}
                      label={field.label}
                      columns={columns}
                      value={
                        entity.identifierColumns?.find(
                          (item) => item.kind === field.identifier_kind
                        )?.column
                      }
                      onChange={(value) =>
                        setEntity({
                          ...entity,
                          identifierColumns: [
                            ...(entity.identifierColumns ?? []).filter(
                              (item) => item.kind !== field.identifier_kind
                            ),
                            ...(value === undefined
                              ? []
                              : [{ kind: field.identifier_kind!, column: value }])
                          ]
                        })
                      }
                    />
                  ))}
              </div>
            </section>
            <section className="grid gap-4 border-t border-border pt-6">
              <h2 className="text-lg font-semibold">{t("mapFields")}</h2>
              <p className="text-sm text-muted">{t("optionalFields")}</p>
              {entityFields
                .filter((field) => !field.identifier_kind)
                .map((field) => {
                  const mapped = entity.fields?.find((item) => item.key === field.key);
                  const update = (patch: object) =>
                    setEntity({
                      ...entity,
                      fields: entity.fields?.map((item) =>
                        item.key === field.key ? { ...item, ...patch } : item
                      )
                    });
                  return (
                    <div
                      key={field.key}
                      className="grid gap-3 border-b border-border pb-4 md:grid-cols-2"
                    >
                      <ColumnField
                        label={`${field.label}${field.required ? " *" : ""}`}
                        columns={columns}
                        required={field.required}
                        value={mapped?.column}
                        onChange={(column) =>
                          setEntity({
                            ...entity,
                            fields: [
                              ...(entity.fields ?? []).filter((item) => item.key !== field.key),
                              ...(column === undefined
                                ? []
                                : [{ key: field.key, type: field.type, column, ...defaults }])
                            ]
                          })
                        }
                      />
                      {mapped && fieldOptions(mapped, update)}
                    </div>
                  );
                })}
            </section>
          </>
        ) : (
          <>
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">{t("identifyDocuments")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={t("matchDocumentsBy")}
                  value={document.documentBy.strategy}
                  onChange={(e) =>
                    setDocument({
                      ...document,
                      documentBy: {
                        ...document.documentBy,
                        strategy: e.target.value as DocumentImportMapping["documentBy"]["strategy"]
                      }
                    })
                  }
                >
                  {(["filename", "checksum", "paperless_id"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`match.${value}`)}
                    </option>
                  ))}
                </SelectField>
                <ColumnField
                  label={t("sourceColumn")}
                  columns={columns}
                  required
                  value={document.documentBy.column}
                  onChange={(column) =>
                    setDocument({
                      ...document,
                      documentBy: { ...document.documentBy, column: column ?? -1 }
                    })
                  }
                />
              </div>
              {kind === "documents" && (
                <SelectField
                  label={t("duplicates")}
                  value={document.duplicateStrategy}
                  onChange={(e) =>
                    setDocument({
                      ...document,
                      duplicateStrategy: e.target
                        .value as DocumentImportMapping["duplicateStrategy"]
                    })
                  }
                >
                  {(["skip", "fail", "create_anyway"] as const).map((value) => (
                    <option value={value} key={value}>
                      {t(`duplicate.${value}`)}
                    </option>
                  ))}
                </SelectField>
              )}
            </section>
            <section className="grid gap-4 border-t border-border pt-6">
              <div>
                <h2 className="text-lg font-semibold">{t("connectEntities")}</h2>
                <p className="mt-1 max-w-prose text-sm text-muted">{t("entityOrderWarning")}</p>
              </div>
              {document.entityLinks.map((link, index) => (
                <div key={index} className="grid gap-4 border-b border-border pb-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{t("connectionNumber", { number: index + 1 })}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeConnection", { number: index + 1 })}
                      onClick={() =>
                        setDocument({
                          ...document,
                          entityLinks: document.entityLinks.filter((_, i) => i !== index)
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <SelectField
                      label={t("entityType")}
                      value={link.entityTypeKey}
                      required
                      onChange={(e) =>
                        updateLink(index, {
                          entityTypeKey: e.target.value,
                          identifierKind: fieldsOf(
                            entityTypes.find((type) => type.key === e.target.value)
                          ).find((field) => field.identifier_kind)?.identifier_kind
                        })
                      }
                    >
                      {entityTypes.map((type) => (
                        <option key={type.key} value={type.key}>
                          {type.name_plural}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      label={t("matchEntitiesBy")}
                      value={link.matchBy}
                      onChange={(e) =>
                        updateLink(index, {
                          matchBy: e.target.value as EntityLinkMapping["matchBy"]
                        })
                      }
                    >
                      {(["identifier", "display_name", "id"] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(`match.${value}`)}
                        </option>
                      ))}
                    </SelectField>
                    {link.matchBy === "identifier" && (
                      <SelectField
                        label={t("identifier")}
                        value={link.identifierKind ?? ""}
                        required
                        onChange={(e) => updateLink(index, { identifierKind: e.target.value })}
                      >
                        <option value="">{t("chooseIdentifier")}</option>
                        {fieldsOf(entityTypes.find((type) => type.key === link.entityTypeKey))
                          .filter((field) => field.identifier_kind)
                          .map((field) => (
                            <option key={field.key} value={field.identifier_kind}>
                              {field.label}
                            </option>
                          ))}
                      </SelectField>
                    )}
                    <ColumnField
                      label={t("sourceColumn")}
                      columns={columns}
                      required
                      value={link.column}
                      onChange={(column) => updateLink(index, { column: column ?? -1 })}
                    />
                    <SelectField
                      label={t("relation")}
                      value={link.relation}
                      onChange={(e) =>
                        updateLink(index, {
                          relation: e.target.value as EntityLinkMapping["relation"]
                        })
                      }
                    >
                      {(
                        ["related", "belongs_to", "issued_to", "assigned_to", "part_of"] as const
                      ).map((value) => (
                        <option key={value} value={value}>
                          {t(`relations.${value}`)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      label={t("onMissing")}
                      value={link.onMissing}
                      onChange={(e) =>
                        updateLink(index, {
                          onMissing: e.target.value as EntityLinkMapping["onMissing"]
                        })
                      }
                    >
                      {(["fail_row", "skip_connection", "create"] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(`missing.${value}`)}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                disabled={!entityTypes.length}
                onClick={() =>
                  setDocument({
                    ...document,
                    entityLinks: [
                      ...document.entityLinks,
                      {
                        entityTypeKey: entityTypes[0].key,
                        matchBy: "identifier",
                        identifierKind: fieldsOf(entityTypes[0]).find(
                          (field) => field.identifier_kind
                        )?.identifier_kind,
                        column: 0,
                        relation: "related",
                        onMissing: "fail_row"
                      }
                    ]
                  })
                }
              >
                <Plus size={16} />
                {t("addConnection")}
              </Button>
            </section>
            <section className="grid gap-4 border-t border-border pt-6">
              <h2 className="text-lg font-semibold">{t("mapFields")}</h2>
              {[
                { key: "__date", label: t("documentDate"), data_type: "date" },
                ...supportedCustomFields
              ].map((field) => {
                const mapped = document.fields.find((item) =>
                  field.key === "__date"
                    ? item.target === "document_date"
                    : item.target === "custom_field" && item.key === field.key
                );
                const remaining = document.fields.filter((item) => item !== mapped);
                return (
                  <div
                    key={field.key}
                    className="grid gap-3 border-b border-border pb-4 md:grid-cols-2"
                  >
                    <ColumnField
                      label={field.label}
                      columns={columns}
                      value={mapped?.column}
                      onChange={(column) =>
                        setDocument({
                          ...document,
                          fields: [
                            ...remaining,
                            ...(column === undefined
                              ? []
                              : [
                                  field.key === "__date"
                                    ? {
                                        target: "document_date" as const,
                                        column,
                                        dateFormat: defaults.dateFormat
                                      }
                                    : ({
                                        target: "custom_field" as const,
                                        key: field.key,
                                        column,
                                        type: field.data_type,
                                        ...defaults
                                      } as DocumentFieldMapping)
                                ])
                          ]
                        })
                      }
                    />
                    {mapped &&
                      fieldOptions(
                        {
                          ...mapped,
                          type: mapped.target === "document_date" ? "date" : mapped.type
                        },
                        (patch) =>
                          setDocument({
                            ...document,
                            fields: document.fields.map((item) =>
                              item === mapped ? { ...item, ...patch } : item
                            )
                          })
                      )}
                  </div>
                );
              })}
            </section>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p className="text-sm text-muted">{t("validationHelp")}</p>
        <Button disabled={busy || !columns.length} type="submit">
          {busy ? t("validating") : t("validateAll")}
        </Button>
      </div>
    </form>
  );
}
