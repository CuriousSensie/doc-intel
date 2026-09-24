"use client";

import { TextField } from "@/components/forms/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { inviteMemberAction } from "@/modules/organizations/organizations.actions";

export function InviteMemberDialog({
  organizationId,
  labels
}: {
  organizationId: string;
  labels: {
    trigger: string;
    title: string;
    nameLabel: string;
    emailLabel: string;
    roleLabel: string;
    roleMember: string;
    roleAdmin: string;
    roleReadOnly: string;
    submit: string;
  };
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <form action={inviteMemberAction} className="grid gap-4">
          <input name="organizationId" type="hidden" value={organizationId} />
          <TextField label={labels.nameLabel} name="name" required />
          <TextField label={labels.emailLabel} name="email" required type="email" />
          <label className="grid gap-2 text-sm font-semibold">
            <span>{labels.roleLabel}</span>
            <select
              className="min-h-11 rounded-md border border-border bg-panel px-3 text-base font-normal outline-none transition focus:border-foreground focus:ring-2 focus:ring-foreground/15"
              defaultValue="member"
              name="role"
            >
              <option value="member">{labels.roleMember}</option>
              <option value="admin">{labels.roleAdmin}</option>
              <option value="read-only">{labels.roleReadOnly}</option>
            </select>
          </label>
          <DialogFooter>
            <Button type="submit">{labels.submit}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
