import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import {
  markAllAsReadAction,
  markAsReadAction
} from "@/modules/notifications/notifications.actions";
import { getUnreadCount, listNotifications } from "@/modules/notifications/notifications.service";

export const dynamic = "force-dynamic";

function documentIdOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const id = (metadata as { documentId?: unknown }).documentId;
  return typeof id === "string" ? id : null;
}

export default async function NotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; error?: string; message?: string }>;
}) {
  requireFeature("notifications");
  const context = await requireUser("/dashboard/notifications");
  const t = await getTranslations("dashboard");
  const params = await searchParams;

  const [{ items, nextCursor }, unreadCount] = await Promise.all([
    listNotifications(context.user.id, { cursor: params.cursor }),
    getUnreadCount(context.user.id)
  ]);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-black">{t("notifications.title")}</h1>
            <p className="mt-1 text-sm text-muted">
              {unreadCount > 0
                ? t("notifications.unreadCount", { count: unreadCount })
                : t("notifications.caughtUp")}
            </p>
          </div>
          {unreadCount > 0 ? (
            <form action={markAllAsReadAction}>
              <Button type="submit" variant="outline">
                {t("notifications.markAllAsRead")}
              </Button>
            </form>
          ) : null}
        </div>
        <div className="mt-6">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="grid gap-3">
        {items.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel p-6 text-muted">
            {t("notifications.empty")}
          </p>
        ) : (
          items.map((notification) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-panel p-4 shadow-sm sm:flex-row sm:items-start"
              key={notification.id}
            >
              <div>
                <p className="font-semibold">
                  {notification.title}
                  {!notification.read_at ? (
                    <span className="ml-2 rounded-full bg-panel-strong px-2 py-0.5 text-xs font-semibold text-muted">
                      {t("notifications.new")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted">{notification.message}</p>
                {documentIdOf(notification.metadata) ? (
                  <Link
                    className="mt-1 inline-block text-sm font-semibold underline underline-offset-4"
                    href={`/dashboard/documents/${documentIdOf(notification.metadata)}`}
                  >
                    {t("notifications.openDocument")}
                  </Link>
                ) : null}
                <p className="mt-2 text-xs text-muted">
                  {new Date(notification.created_at).toLocaleString()}
                </p>
              </div>
              {!notification.read_at ? (
                <form action={markAsReadAction}>
                  <input name="notificationId" type="hidden" value={notification.id} />
                  <Button size="sm" type="submit" variant="outline">
                    {t("notifications.markRead")}
                  </Button>
                </form>
              ) : null}
            </div>
          ))
        )}
      </section>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={`/dashboard/notifications?cursor=${encodeURIComponent(nextCursor)}`}>
              {t("notifications.nextPage")}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
