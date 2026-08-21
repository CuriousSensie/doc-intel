import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

import { appConfig } from "@/config/app";

export function EmailLayout({
  previewText,
  heading,
  children
}: {
  previewText: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.logo}>{appConfig.logo.label}</Text>
          <Heading style={styles.heading}>{heading}</Heading>
          <Section>{children}</Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            {appConfig.name} &middot; Questions? Contact{" "}
            <a href={`mailto:${appConfig.supportEmail}`} style={styles.link}>
              {appConfig.supportEmail}
            </a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, CSSProperties> = {
  body: {
    backgroundColor: "#f4f4f5",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "40px 0"
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "480px",
    padding: "32px"
  },
  logo: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#6b7280"
  },
  heading: {
    fontSize: "22px",
    fontWeight: 800,
    margin: "16px 0"
  },
  hr: {
    borderColor: "#e5e7eb",
    margin: "32px 0 16px"
  },
  footer: {
    color: "#6b7280",
    fontSize: "12px",
    lineHeight: "18px"
  },
  link: {
    color: "#111827",
    textDecoration: "underline"
  }
};
