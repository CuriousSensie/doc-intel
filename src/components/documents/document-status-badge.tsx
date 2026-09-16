import { Badge } from "@/components/ui/badge";

const FAILED_STATUSES = new Set(["failed", "orphaned", "expired"]);
const DONE_STATUSES = new Set(["ready", "completed"]);

// Shared by the documents list page, the bulk list, and every view-mode component — was
// duplicated in both call sites before the view-mode split made that three copies.
export function DocumentStatusBadge({ status }: { status: string }) {
  if (FAILED_STATUSES.has(status)) return <Badge variant="danger">{status}</Badge>;
  if (DONE_STATUSES.has(status)) return <Badge variant="accent">{status}</Badge>;
  return <Badge variant="muted">{status}</Badge>;
}
