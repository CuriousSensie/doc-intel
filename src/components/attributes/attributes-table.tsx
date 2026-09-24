"use client";

import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { deleteAttributeFormAction } from "@/modules/attributes/attributes.actions";
import type { AttributeRow } from "@/modules/attributes/attributes.service";
import type { AttributeKind } from "@/modules/attributes/attributes.schemas";

export function AttributesTable({
  attributes,
  kind,
  documentTypeOptions = []
}: {
  attributes: AttributeRow[];
  kind: AttributeKind;
  documentTypeOptions?: Array<{ key: string; name: string }>;
}) {
  const t = useTranslations("common.attributes");
  // Matching/Documents/View-documents are Paperless-tag-shaped columns that are meaningless for
  // custom fields — a dedicated column set (Scope/Type/Applies to) is shown instead.
  const isCustomFields = kind === "custom-fields";
  const documentTypeNameByKey = new Map(documentTypeOptions.map((dt) => [dt.key, dt.name]));

  return (
    <div className="min-w-0 overflow-x-auto">
      <Table className="min-w-[920px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30%]">{t("columns.name")}</TableHead>
            {isCustomFields ? (
              <>
                <TableHead className="w-36">{t("columns.scope")}</TableHead>
                <TableHead className="w-44">{t("columns.dataType")}</TableHead>
                <TableHead className="w-56">{t("columns.appliesTo")}</TableHead>
              </>
            ) : (
              <>
                <TableHead className="w-44">{t("columns.matching")}</TableHead>
                <TableHead className="w-40">{t("columns.documents")}</TableHead>
                <TableHead className="w-44">{t("columns.viewDocuments")}</TableHead>
              </>
            )}
            <TableHead className="w-24">
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attributes.map((attribute) => (
            <TableRow key={attribute.id}>
              <TableCell className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  {attribute.color ? (
                    <span
                      aria-hidden
                      className="size-4 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: attribute.color }}
                    />
                  ) : null}
                  <span className="truncate font-semibold" title={attribute.name}>
                    {attribute.name}
                  </span>
                </div>
              </TableCell>
              {isCustomFields ? (
                <>
                  <TableCell>
                    <Badge variant={attribute.appliesTo && attribute.appliesTo.length > 0 ? "outline" : "muted"}>
                      {attribute.appliesTo && attribute.appliesTo.length > 0
                        ? t("scope.documentScoped")
                        : t("scope.global")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted">
                    {attribute.dataType ? t(`dataTypes.${attribute.dataType}`) : ""}
                  </TableCell>
                  <TableCell className="text-muted">
                    {attribute.appliesTo && attribute.appliesTo.length > 0
                      ? attribute.appliesTo
                          .map((key) => documentTypeNameByKey.get(key) ?? key)
                          .join(", ")
                      : t("columns.appliesToAll")}
                  </TableCell>
                </>
              ) : (
                <>
                  <TableCell>
                    <Badge variant={attribute.matchingAlgorithm === "none" ? "muted" : "outline"}>
                      {t(`matching.${attribute.matchingAlgorithm}.label`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted tabular-nums">{attribute.documentCount}</TableCell>
                  <TableCell>
                    {attribute.canViewDocuments ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={attribute.viewDocumentsHref}>
                          <Eye aria-hidden className="size-4" />
                          {t("viewDocuments")}
                        </Link>
                      </Button>
                    ) : (
                      <Button disabled size="sm" variant="outline">
                        <Eye aria-hidden className="size-4" />
                        {t("viewDocuments")}
                      </Button>
                    )}
                  </TableCell>
                </>
              )}
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label={t("openActions")} size="icon" variant="ghost">
                      <MoreHorizontal aria-hidden className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/attributes/${attribute.kind}?edit=${attribute.id}`}>
                        <Pencil aria-hidden className="size-4" />
                        {t("edit")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <form
                        action={deleteAttributeFormAction}
                        onSubmit={(event) => {
                          if (!window.confirm(t("confirmDelete", { name: attribute.name }))) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="kind" type="hidden" value={attribute.kind} />
                        <input name="id" type="hidden" value={attribute.id} />
                        <button className="flex w-full items-center gap-2 text-left text-danger" type="submit">
                          <Trash2 aria-hidden className="size-4" />
                          {t("delete")}
                        </button>
                      </form>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
