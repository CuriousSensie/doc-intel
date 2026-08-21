import { Button, Text } from "@react-email/components";

import { EmailLayout } from "@/emails/layout";

export function OrganizationInvitationEmail({
  organizationName,
  inviterName,
  role,
  acceptUrl
}: {
  organizationName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  return (
    <EmailLayout
      heading={`Join ${organizationName}`}
      previewText={`${inviterName} invited you to join ${organizationName}`}
    >
      <Text style={{ fontSize: "15px", lineHeight: "24px", color: "#111827" }}>
        {inviterName} invited you to join <strong>{organizationName}</strong> as a {role}.
      </Text>
      <Button
        href={acceptUrl}
        style={{
          backgroundColor: "#111827",
          borderRadius: "6px",
          color: "#ffffff",
          fontSize: "14px",
          fontWeight: 600,
          padding: "12px 20px",
          textDecoration: "none"
        }}
      >
        Accept invitation
      </Button>
      <Text style={{ fontSize: "13px", color: "#6b7280", marginTop: "16px", wordBreak: "break-all" }}>
        Or copy this link: {acceptUrl}
      </Text>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
