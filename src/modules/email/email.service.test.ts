import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({
  sendRenderedEmail: vi.fn().mockResolvedValue({ id: "mock-id" })
}));

import { sendRenderedEmail } from "@/lib/email";
import { sendEmail } from "@/modules/email/email.service";

const variables = {
  organizationName: "Acme Inc",
  inviterName: "Ada Lovelace",
  role: "admin",
  acceptUrl: "http://localhost:3000/invitations/abc123"
};

describe("sendEmail", () => {
  it("renders the organization invitation template and sends it", async () => {
    const result = await sendEmail({
      to: "member@example.com",
      template: "organization-invitation",
      variables
    });

    expect(result).toEqual({ id: "mock-id" });
    expect(sendRenderedEmail).toHaveBeenCalledTimes(1);

    const [message] = vi.mocked(sendRenderedEmail).mock.calls[0];
    expect(message.to).toBe("member@example.com");
    expect(message.subject).toContain("Acme Inc");
    expect(message.html).toContain("Acme Inc");
    expect(message.text).toContain("Accept invitation");
  });

  it("returns null and does not throw when sending fails", async () => {
    vi.mocked(sendRenderedEmail).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await sendEmail({
      to: "member@example.com",
      template: "organization-invitation",
      variables
    });

    expect(result).toBeNull();
  });
});
