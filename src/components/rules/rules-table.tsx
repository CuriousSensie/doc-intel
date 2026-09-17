"use client";

import { Edit3, MoreHorizontal, Play, Power, Trash2 } from "lucide-react";
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
import {
  deleteRuleFormAction,
  startRuleBackfillFormAction,
  toggleRuleEnabledFormAction
} from "@/modules/rules/rules.actions";
import { triggerMessageKey, type RuleTrigger } from "@/modules/rules/rules.schemas";

type RuleRow = {
  id: string;
  name: string;
  trigger: RuleTrigger;
  enabled: boolean;
  conditionsCount: number;
  actionsCount: number;
  runsCount: number;
};

function CountChip({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-panel px-2 text-xs font-semibold text-muted">
      {count} {label}
    </span>
  );
}

export function RulesTable({ rules }: { rules: RuleRow[] }) {
  const t = useTranslations("rules");

  return (
    <div className="min-w-0 overflow-x-auto">
      <Table className="min-w-[1100px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-72">{t("list.columns.name")}</TableHead>
            <TableHead className="w-48">{t("list.columns.trigger")}</TableHead>
            <TableHead className="w-44">{t("list.columns.conditions")}</TableHead>
            <TableHead className="w-44">{t("list.columns.actions")}</TableHead>
            <TableHead className="w-32">{t("list.columns.runs")}</TableHead>
            <TableHead className="w-36">{t("list.columns.status")}</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">{t("list.columns.actionsMenu")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell className="w-72">
                <Link
                  className="block truncate font-semibold underline-offset-4 hover:underline"
                  href={`/dashboard/rules/${rule.id}`}
                  title={rule.name}
                >
                  {rule.name}
                </Link>
              </TableCell>
              <TableCell className="w-48 text-muted">
                {t(`triggers.${triggerMessageKey(rule.trigger)}`)}
              </TableCell>
              <TableCell className="w-44">
                <CountChip count={rule.conditionsCount} label={t("list.conditionCount")} />
              </TableCell>
              <TableCell className="w-44">
                <CountChip count={rule.actionsCount} label={t("list.actionCount")} />
              </TableCell>
              <TableCell className="w-32 text-muted">{rule.runsCount}</TableCell>
              <TableCell className="w-36">
                <Badge variant={rule.enabled ? "accent" : "muted"}>
                  {rule.enabled ? t("list.enabled") : t("list.disabled")}
                </Badge>
              </TableCell>
              <TableCell className="w-28">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-label={t("list.openActions")} size="icon" variant="ghost">
                      <MoreHorizontal aria-hidden className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/rules/${rule.id}`}>
                        <Edit3 aria-hidden className="size-4" />
                        {t("list.editRule")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <form action={toggleRuleEnabledFormAction}>
                        <input name="ruleId" type="hidden" value={rule.id} />
                        <input name="enabled" type="hidden" value={(!rule.enabled).toString()} />
                        <input name="redirectTo" type="hidden" value="/dashboard/rules" />
                        <button className="flex w-full items-center gap-2 text-left" type="submit">
                          <Power aria-hidden className="size-4" />
                          {rule.enabled ? t("detail.disable") : t("detail.enable")}
                        </button>
                      </form>
                    </DropdownMenuItem>
                    {rule.trigger === "manual" ? (
                      <DropdownMenuItem asChild>
                        <form action={startRuleBackfillFormAction}>
                          <input name="ruleId" type="hidden" value={rule.id} />
                          <input name="redirectTo" type="hidden" value="/dashboard/rules" />
                          <button className="flex w-full items-center gap-2 text-left" type="submit">
                            <Play aria-hidden className="size-4" />
                            {t("list.triggerRule")}
                          </button>
                        </form>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem asChild>
                      <form
                        action={deleteRuleFormAction}
                        onSubmit={(event) => {
                          if (!window.confirm(t("detail.confirmDelete"))) event.preventDefault();
                        }}
                      >
                        <input name="ruleId" type="hidden" value={rule.id} />
                        <button className="flex w-full items-center gap-2 text-left text-danger" type="submit">
                          <Trash2 aria-hidden className="size-4" />
                          {t("detail.delete")}
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
