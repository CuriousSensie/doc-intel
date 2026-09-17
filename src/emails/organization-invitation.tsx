import { Button, Text } from "@react-email/components";

import { EmailLayout, getEmailTranslator } from "@/emails/layout";
import { routing, type Locale } from "@/i18n/routing";

export function OrganizationInvitationEmail({
  organizationName,
  inviterName,
  role,
  acceptUrl,
  locale = routing.defaultLocale
}: {
  organizationName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  locale?: Locale;
}) {
  const t = getEmailTranslator(locale);

  return (
    <EmailLayout
      heading={t("emails.organizationInvitation.heading", { organizationName })}
      previewText={t("emails.organizationInvitation.previewText", { inviterName, organizationName })}
      locale={locale}
    >
      <Text style={{ fontSize: "15px", lineHeight: "24px", color: "#111827" }}>
        {t.rich("emails.organizationInvitation.body", {
          inviterName,
          organizationName,
          role,
          name: (chunks) => <strong>{chunks}</strong>
        })}
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
        {t("emails.organizationInvitation.acceptButton")}
      </Button>
      <Text style={{ fontSize: "13px", color: "#6b7280", marginTop: "16px", wordBreak: "break-all" }}>
        {t("emails.organizationInvitation.copyLink")} {acceptUrl}
      </Text>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
