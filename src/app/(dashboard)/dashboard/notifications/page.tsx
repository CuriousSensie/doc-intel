import Link from "next/link";

import { FormMessage } from "@/components/forms/form-message";
import { Button } from "@/components/ui/button";
import { requireFeature } from "@/modules/auth/authorization";
import { requireUser } from "@/modules/auth/session";
import { markAllAsReadAction, markAsReadAction } from "@/modules/notifications/notifications.actions";
import { getUnreadCount, listNotifications } from "@/modules/notifications/notifications.service";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ cursor?: string; error?: string; message?: string }>;
}) {
  requireFeature("notifications");
  const context = await requireUser("/dashboard/notifications");
  const params = await searchParams;

  const [{ items, nextCursor }, unreadCount] = await Promise.all([
    listNotifications(context.user.id, { cursor: params.cursor }),
    getUnreadCount(context.user.id)
  ]);

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl gap-5 px-6 py-10">
      <section className="rounded-lg border border-border bg-panel p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Dashboard</p>
            <h1 className="mt-3 text-3xl font-black">Notifications</h1>
            <p className="mt-1 text-sm text-muted">
              {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
            </p>
          </div>
          {unreadCount > 0 ? (
            <form action={markAllAsReadAction}>
              <Button type="submit" variant="outline">
                Mark all as read
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
            You have no notifications yet.
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
                      New
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted">{notification.message}</p>
                <p className="mt-2 text-xs text-muted">{new Date(notification.created_at).toLocaleString()}</p>
              </div>
              {!notification.read_at ? (
                <form action={markAsReadAction}>
                  <input name="notificationId" type="hidden" value={notification.id} />
                  <Button size="sm" type="submit" variant="outline">
                    Mark read
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
            <Link href={`/dashboard/notifications?cursor=${encodeURIComponent(nextCursor)}`}>Next page</Link>
          </Button>
        </div>
      ) : null}
    </main>
  );
}
