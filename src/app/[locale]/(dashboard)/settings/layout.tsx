import type { ReactNode } from "react";

import { SettingsTabs } from "@/components/layout/settings-tabs";
import { isFeatureEnabled } from "@/config/features";
import { settingsNavigation } from "@/config/navigation";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const items = settingsNavigation.filter(
    (item) => !item.feature || isFeatureEnabled(item.feature)
  );

  return (
    <div className="grid gap-5">
      <SettingsTabs items={items} />
      <div>{children}</div>
    </div>
  );
}
