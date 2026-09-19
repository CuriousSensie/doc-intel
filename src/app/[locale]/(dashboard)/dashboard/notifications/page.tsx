import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { FormMessage } from "@/components/forms/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
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
    <div className="grid min-w-0 gap-5">
      <section className="rounded-lg border border-border bg-panel p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
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
              <Button className="w-full sm:w-auto" type="submit" variant="outline">
                {t("notifications.markAllAsRead")}
              </Button>
            </form>
          ) : null}
        </div>
        <div className="mt-4">
          <FormMessage error={params.error} message={params.message} />
        </div>
      </section>

      <section className="min-w-0">
        {items.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("notifications.empty")}</CardTitle>
              <CardDescription>{t("notifications.emptyDescription")}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Table className="min-w-[56rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-normal">
                  {t("notifications.columns.notification")}
                </TableHead>
                <TableHead className="w-32 whitespace-normal">
                  {t("notifications.columns.created")}
                </TableHead>
                <TableHead className="w-24 whitespace-normal">
                  {t("notifications.columns.status")}
                </TableHead>
                <TableHead className="w-36 whitespace-normal">
                  <span className="sr-only">{t("notifications.columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((notification) => {
                const documentId = documentIdOf(notification.metadata);

                return (
                  <TableRow key={notification.id}>
                    <TableCell className="min-w-0">
                      <p className="font-semibold">{notification.title}</p>
                      <p className="mt-1 break-words text-sm text-muted">{notification.message}</p>
                    </TableCell>
                    <TableCell className="break-words text-sm text-muted">
                      {new Date(notification.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {!notification.read_at ? (
                        <Badge variant="accent">{t("notifications.new")}</Badge>
                      ) : (
                        <Badge variant="muted">{t("notifications.read")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2 sm:items-end">
                        {documentId ? (
                          <Button
                            asChild
                            className="w-full px-2 sm:w-auto"
                            size="sm"
                            variant="outline"
                          >
                            <Link href={`/dashboard/documents/${documentId}`}>
                              {t("notifications.openDocument")}
                            </Link>
                          </Button>
                        ) : null}
                        {!notification.read_at ? (
                          <form action={markAsReadAction}>
                            <input name="notificationId" type="hidden" value={notification.id} />
                            <Button
                              className="w-full px-2 sm:w-auto"
                              size="sm"
                              type="submit"
                              variant="outline"
                            >
                              {t("notifications.markRead")}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
