import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Out of scope for this build (temp.md §AI Overview) — a disabled placeholder only, no
// functionality, shared verbatim between the Owner and Team Member dashboards. `h-full` +
// centered content: this card sits next to the (much taller) Stats card in a stretched grid row,
// so it needs to fill that height gracefully instead of leaving dead space under a short card.
export async function AiOverviewCard() {
  const t = await getTranslations("dashboard.home");

  return (
    <Card className="flex h-full flex-col opacity-70">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("aiOverview")}</CardTitle>
        <Badge variant="muted">{t("comingSoon")}</Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-panel-strong text-muted">
          <Sparkles aria-hidden="true" className="size-5" />
        </div>
        <p className="max-w-xs text-sm text-muted">{t("aiOverviewDescription")}</p>
      </CardContent>
    </Card>
  );
}
