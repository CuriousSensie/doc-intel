import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Out of scope for this build (temp.md §AI Overview) — a disabled placeholder only, no
// functionality, shared verbatim between the Owner and Team Member dashboards.
export async function AiOverviewCard() {
  const t = await getTranslations("dashboard.home");

  return (
    <Card className="opacity-70">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{t("aiOverview")}</CardTitle>
        <Badge variant="muted">{t("comingSoon")}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">{t("aiOverviewDescription")}</p>
      </CardContent>
    </Card>
  );
}
