import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en/folders.json";
import documentsMessages from "@/../messages/en/documents.json";

import type { Document } from "@/modules/documents/documents.service";
import type { Folder } from "@/modules/folders/folders.service";

import { FolderExplorer } from "./folder-explorer";

const push = vi.hoisted(() => vi.fn());
const listFolderTreeAction = vi.hoisted(() => vi.fn());
const listFolderDocumentsAction = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/navigation", () => ({
  // Radix's DropdownMenuItem asChild clones this; a host anchor keeps the test free of the real
  // locale-aware Link.
  Link: "a",
  useRouter: () => ({ push })
}));

// DocumentActionsMenu (rendered on each document leaf) imports these; stubbed so this explorer
// test never pulls in the server-action/Paperless modules behind them.
vi.mock("@/modules/documents/documents.actions", () => ({
  updateDocumentAction: vi.fn(),
  deleteDocumentAction: vi.fn()
}));

vi.mock("@/modules/documents/document-shares.actions", () => ({
  getDocumentPermissionsAction: vi.fn()
}));

vi.mock("@/modules/folders/folders.actions", () => ({
  listFolderTreeAction,
  listFolderDocumentsAction,
  // Referenced transitively by folder-tree.tsx's mutation dialogs — not exercised by this test.
  createFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  moveFolderAction: vi.fn(),
  moveDocumentsToFolderAction: vi.fn(),
  renameFolderAction: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

const invoicesFolder: Folder = {
  id: "folder-invoices",
  parentFolderId: null,
  name: "Invoices",
  path: "/Invoices",
  depth: 0,
  matchConditions: null,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  accessLevel: "full",
  documentCount: 2,
  childFolderCount: 0
};

function fakeDocument(id: string, title: string): Document {
  return { id, title } as unknown as Document;
}

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: documentsMessages, folders: messages }}>
      <FolderExplorer />
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
  listFolderTreeAction.mockReset();
  listFolderDocumentsAction.mockReset();
});

describe("FolderExplorer", () => {
  it("fetches a folder's documents once and re-expanding reuses the cache", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [fakeDocument("doc-1", "Receipt.pdf"), fakeDocument("doc-2", "Statement.pdf")],
      totalCount: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();

    const tree = await screen.findByRole("navigation");
    const folderName = () => within(tree).getByText("Invoices");
    await waitFor(() => expect(folderName()).toBeVisible());

    // Expand — first fetch for this folder.
    fireEvent.click(folderName());
    await waitFor(() => expect(screen.getByText("Receipt.pdf")).toBeVisible());
    expect(listFolderDocumentsAction).toHaveBeenCalledTimes(1);
    expect(listFolderDocumentsAction).toHaveBeenCalledWith("folder-invoices", { page: 1, pageSize: 25 });

    // Collapse.
    fireEvent.click(folderName());
    await waitFor(() => expect(screen.queryByText("Receipt.pdf")).not.toBeInTheDocument());

    // Re-expand — must reuse the cached documents, not fetch again.
    fireEvent.click(folderName());
    await waitFor(() => expect(screen.getByText("Receipt.pdf")).toBeVisible());
    expect(listFolderDocumentsAction).toHaveBeenCalledTimes(1);

    // One more collapse/expand cycle for good measure — still exactly one call.
    fireEvent.click(folderName());
    fireEvent.click(folderName());
    await waitFor(() => expect(screen.getByText("Receipt.pdf")).toBeVisible());
    expect(listFolderDocumentsAction).toHaveBeenCalledTimes(1);
  });

  it("navigates to a document's detail page on click", async () => {
    listFolderTreeAction.mockResolvedValue([invoicesFolder]);
    listFolderDocumentsAction.mockResolvedValue({
      items: [fakeDocument("doc-1", "Receipt.pdf")],
      totalCount: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      nextCursor: null
    });

    view();
    const tree = await screen.findByRole("navigation");
    await waitFor(() => expect(within(tree).getByText("Invoices")).toBeVisible());
    fireEvent.click(within(tree).getByText("Invoices"));
    await waitFor(() => expect(screen.getByText("Receipt.pdf")).toBeVisible());

    fireEvent.click(screen.getByText("Receipt.pdf"));
    expect(push).toHaveBeenCalledWith("/dashboard/documents/doc-1");
  });
});
