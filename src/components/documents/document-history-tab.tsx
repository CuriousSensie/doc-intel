import { getTranslations } from "next-intl/server";

import type { DocumentHistoryEntry } from "@/modules/documents/documents.service";

export async function DocumentHistoryTab({ history }: { history: DocumentHistoryEntry[] }) {
  const t = await getTranslations("documents.detail");

  if (history.length === 0) {
    return <p className="text-sm text-muted">{t("noHistory")}</p>;
  }

  return (
    <ul className="grid gap-3 text-sm">
      {history.map((entry) => (
        <li className="border-b border-border pb-3 last:border-0 last:pb-0" key={`${entry.source}-${entry.id}`}>
          <p className="font-semibold">
            {entry.action}
            {entry.source === "paperless" && entry.actorUsername ? ` — ${entry.actorUsername}` : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">{new Date(entry.timestamp).toLocaleString("sl-SI")}</p>
        </li>
      ))}
    </ul>
  );
}
