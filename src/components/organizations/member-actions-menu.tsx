"use client";

import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  blockMemberAction,
  removeMemberAction,
  unblockMemberAction,
  updateMemberRoleAction
} from "@/modules/organizations/organizations.actions";

const ASSIGNABLE_ROLES = ["admin", "member", "read-only"] as const;

// A kebab menu replaces the old stack of always-visible buttons per row (member/admin/
// read-only role change, block/unblock, remove) — that stack was overflowing the row height
// and colliding with the row below it in the table.
export function MemberActionsMenu({
  organizationId,
  memberId,
  currentRole,
  isBlocked,
  roleLabels,
  labels
}: {
  organizationId: string;
  memberId: string;
  currentRole: string;
  isBlocked: boolean;
  roleLabels: Record<(typeof ASSIGNABLE_ROLES)[number], string>;
  labels: {
    moreActions: string;
    changeRoleTo: string;
    block: string;
    unblock: string;
    remove: string;
  };
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={labels.moreActions}
          className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-panel transition hover:bg-panel-strong"
          type="button"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ASSIGNABLE_ROLES.filter((role) => role !== currentRole).map((role) => (
          <form action={updateMemberRoleAction} key={role}>
            <input name="organizationId" type="hidden" value={organizationId} />
            <input name="memberId" type="hidden" value={memberId} />
            <input name="role" type="hidden" value={role} />
            <DropdownMenuItem asChild>
              <button className="w-full text-left" type="submit">
                {labels.changeRoleTo} {roleLabels[role]}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
        <DropdownMenuSeparator />
        <form action={isBlocked ? unblockMemberAction : blockMemberAction}>
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="memberId" type="hidden" value={memberId} />
          <DropdownMenuItem asChild>
            <button className="w-full text-left" type="submit">
              {isBlocked ? labels.unblock : labels.block}
            </button>
          </DropdownMenuItem>
        </form>
        <form action={removeMemberAction}>
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="memberId" type="hidden" value={memberId} />
          <DropdownMenuItem asChild>
            <button className="w-full text-left text-danger" type="submit">
              {labels.remove}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
