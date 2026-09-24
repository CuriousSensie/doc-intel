"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  resendInvitationAction,
  revokeInvitationAction
} from "@/modules/organizations/organizations.actions";
import type { OrganizationInvitation } from "@/modules/organizations/organizations.service";

// formatRole() is derived from the translator, which can't cross the server/client boundary
// as a prop — the page formats each invitation's role label before handing the list down here.
type InvitationWithRoleLabel = OrganizationInvitation & { roleLabel: string };

export function PendingInvitationsDialog({
  organizationId,
  invitations,
  labels
}: {
  organizationId: string;
  invitations: InvitationWithRoleLabel[];
  labels: {
    trigger: string;
    title: string;
    nameLabel: string;
    emailLabel: string;
    roleLabel: string;
    expiresLabel: string;
    resend: string;
    revoke: string;
  };
}) {
  if (invitations.length === 0) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {labels.trigger} ({invitations.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <Table className="min-w-[40rem] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-normal">{labels.nameLabel}</TableHead>
              <TableHead className="whitespace-normal">{labels.emailLabel}</TableHead>
              <TableHead className="w-24 whitespace-normal">{labels.roleLabel}</TableHead>
              <TableHead className="w-24 whitespace-normal">{labels.expiresLabel}</TableHead>
              <TableHead className="w-28 whitespace-normal">
                <span className="sr-only">{labels.resend}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="break-words font-semibold">
                  {invitation.invitee_name ?? "—"}
                </TableCell>
                <TableCell className="break-words text-sm text-muted">{invitation.email}</TableCell>
                <TableCell>
                  <Badge variant="muted">{invitation.roleLabel}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted">
                  {new Date(invitation.expires_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-2">
                    <form action={resendInvitationAction}>
                      <input name="organizationId" type="hidden" value={organizationId} />
                      <input name="email" type="hidden" value={invitation.email} />
                      <input name="role" type="hidden" value={invitation.role} />
                      <input name="name" type="hidden" value={invitation.invitee_name ?? ""} />
                      <Button className="w-full px-2" size="sm" type="submit" variant="outline">
                        {labels.resend}
                      </Button>
                    </form>
                    <form action={revokeInvitationAction}>
                      <input name="organizationId" type="hidden" value={organizationId} />
                      <input name="invitationId" type="hidden" value={invitation.id} />
                      <Button className="w-full px-2" size="sm" type="submit" variant="outline">
                        {labels.revoke}
                      </Button>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
