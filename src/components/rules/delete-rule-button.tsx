"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { deleteRuleFormAction } from "@/modules/rules/rules.actions";

// Deleting a rule stops it evaluating (its rule_runs history is kept, per
// docs/IMPLEMENTATION_PLAN.md's Phase 4 soft-delete note) — worth a real confirm, unlike this
// codebase's lighter-weight actions (DisconnectConnectionButton has none).
export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const t = useTranslations("rules.detail");

  return (
    <form
      action={deleteRuleFormAction}
      onSubmit={(event) => {
        if (!window.confirm(t("confirmDelete"))) event.preventDefault();
      }}
    >
      <input name="ruleId" type="hidden" value={ruleId} />
      <Button type="submit" variant="outline">
        {t("delete")}
      </Button>
    </form>
  );
}
