import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en/imports.json";
import type { ImportJob } from "@/modules/imports/imports.service";
import { ImportWorkspace } from "./import-workspace";

const actions = vi.hoisted(() => ({ start: vi.fn(), rows: vi.fn() }));
vi.mock("@/modules/imports/imports.actions", () => ({
  startImportJobAction: actions.start,
  listImportRowsAction: actions.rows,
  analyzeImportJobAction: vi.fn(),
  getImportJobAction: vi.fn(),
  updateImportMappingAction: vi.fn(),
  validateImportJobAction: vi.fn(),
  pauseImportJobAction: vi.fn(),
  resumeImportJobAction: vi.fn(),
  cancelImportJobAction: vi.fn(),
  retryFailedRowsAction: vi.fn(),
  saveImportMappingAction: vi.fn()
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  )
}));
const job: ImportJob = {
  organization_id: "org",
  storage_key: null,
  error: null,
  created_by: "user",
  started_at: null,
  finished_at: null,
  created_at: "2026-09-15T00:00:00Z",
  updated_at: "2026-09-15T00:00:00Z",
  id: "test-job",
  kind: "entities",
  status: "ready",
  source_filename: "customers.csv",
  total_rows: 2,
  processed_rows: 0,
  succeeded_rows: 0,
  failed_rows: 0,
  skipped_rows: 0,
  mapping: {},
  options: { validation: { ok: 2, skippedDuplicate: 0, needsReview: 0, failed: 0 } }
};
function workspace(overrides: Partial<ImportJob> = {}, canWrite = true) {
  actions.rows.mockResolvedValue({ data: { items: [], nextCursor: null } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ imports: messages }}>
      <ImportWorkspace
        initialJob={{ ...job, ...overrides }}
        entityTypes={[]}
        customFields={[]}
        canWrite={canWrite}
      />
    </NextIntlClientProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  actions.start.mockReset();
});

describe("import review and polling", () => {
  it("requires explicit review acknowledgement and prevents double submission", async () => {
    actions.start.mockImplementation(() => new Promise(() => {}));
    workspace();
    const start = screen.getByRole("button", { name: "Start import" });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(actions.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(start).toBeEnabled();
    fireEvent.click(start);
    fireEvent.click(start);
    expect(actions.start).toHaveBeenCalledTimes(1);
    expect(start).toBeDisabled();
    await waitFor(() => expect(screen.getByText("No rows match this filter.")).toBeVisible());
  });
  it("requires fresh validation for older jobs without a persisted review", async () => {
    workspace({ options: {} });
    expect(screen.queryByRole("button", { name: "Start import" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit mapping and revalidate" })).toBeVisible();
    await waitFor(() => expect(actions.rows).toHaveBeenCalled());
  });
  it("does not expose mutation controls to read-only members", async () => {
    workspace({}, false);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start import" })).not.toBeInTheDocument();
    await waitFor(() => expect(actions.rows).toHaveBeenCalled());
  });
  it("aborts the pending poll on unmount and never overlaps requests", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const view = workspace({ status: "running" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
