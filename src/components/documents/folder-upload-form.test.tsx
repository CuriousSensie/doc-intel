import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en/documents.json";

import { FolderUploadForm } from "./folder-upload-form";

const refresh = vi.hoisted(() => vi.fn());
const uploadToSignedUrl = vi.hoisted(() => vi.fn());
const resolveOrCreateFolderPathsAction = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh })
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl })
    }
  })
}));

vi.mock("@/modules/folders/folders.actions", () => ({
  resolveOrCreateFolderPathsAction
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

function view() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: messages }}>
      <FolderUploadForm />
    </NextIntlClientProvider>
  );
}

// jsdom's File doesn't set webkitRelativePath from a constructor — a real webkitdirectory
// selection does, so tests fake it the same way the browser would populate it.
function fileWithRelativePath(relativePath: string): File {
  const name = relativePath.split("/").pop()!;
  const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockReset();
  uploadToSignedUrl.mockReset();
  resolveOrCreateFolderPathsAction.mockReset();
});

describe("FolderUploadForm", () => {
  it("shows a nested preview of the folders a webkitdirectory selection will create", () => {
    view();
    const input = screen.getByLabelText("Choose a folder to upload");
    fireEvent.change(input, {
      target: {
        files: [
          fileWithRelativePath("Documents/Invoices/2025/a.pdf"),
          fileWithRelativePath("Documents/Invoices/2026/b.pdf")
        ]
      }
    });

    expect(screen.getByText("Documents")).toBeVisible();
    expect(screen.getByText("Invoices")).toBeVisible();
    expect(screen.getByText("2025")).toBeVisible();
    expect(screen.getByText("2026")).toBeVisible();
  });

  it("resolves every unique directory once, then uploads each file with its resolved folderId", async () => {
    resolveOrCreateFolderPathsAction.mockResolvedValue({
      "Documents/Invoices/2025": "folder-2025",
      "Documents/Invoices/2026": "folder-2026"
    });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/documents/upload-intent") {
        const body = JSON.parse(String(init?.body)) as { filename: string; folderId: string | null };
        const suffix = body.filename === "a.pdf" ? "1" : "2";
        return {
          ok: true,
          json: async () => ({
            data: { upload_id: `upload-${suffix}`, token: `token-${suffix}`, path: `org/path-${suffix}.pdf` }
          })
        };
      }
      return { ok: true, json: async () => ({ data: { upload_id: "upload-complete", status: "uploaded" } }) };
    });
    vi.stubGlobal("fetch", fetch);
    uploadToSignedUrl.mockResolvedValue({ error: null });

    view();
    fireEvent.change(screen.getByLabelText("Choose a folder to upload"), {
      target: {
        files: [
          fileWithRelativePath("Documents/Invoices/2025/a.pdf"),
          fileWithRelativePath("Documents/Invoices/2026/b.pdf")
        ]
      }
    });

    fireEvent.click(screen.getByRole("button", { name: /Upload 2 files/ }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());

    expect(resolveOrCreateFolderPathsAction).toHaveBeenCalledWith([
      "Documents/Invoices/2025",
      "Documents/Invoices/2026"
    ]);

    const intentCalls = fetch.mock.calls.filter(([url]) => url === "/api/documents/upload-intent");
    expect(intentCalls).toHaveLength(2);
    const bodies = intentCalls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "a.pdf", folderId: "folder-2025" }),
        expect.objectContaining({ filename: "b.pdf", folderId: "folder-2026" })
      ])
    );
  });

  it("fails every queued file and never uploads when folder resolution itself fails", async () => {
    resolveOrCreateFolderPathsAction.mockRejectedValue(new Error("boom"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    view();
    fireEvent.change(screen.getByLabelText("Choose a folder to upload"), {
      target: { files: [fileWithRelativePath("Documents/a.pdf")] }
    });

    fireEvent.click(screen.getByRole("button", { name: /Upload 1 file/ }));

    await waitFor(() => expect(screen.getByText("boom")).toBeVisible());
    expect(fetch).not.toHaveBeenCalled();
  });
});
