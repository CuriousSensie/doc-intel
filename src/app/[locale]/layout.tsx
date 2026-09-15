import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import "../globals.css";

import { routing, type Locale } from "@/i18n/routing";
import { appConfig } from "@/config/app";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(appConfig.url),
    title: {
      default: appConfig.name,
      template: `%s | ${appConfig.name}`
    },
    description: appConfig.description,
    openGraph: {
      title: appConfig.name,
      description: appConfig.description,
      url: appConfig.url,
      siteName: appConfig.name,
      type: "website"
    }
  };
}

export default async function RootLayout({
  children,
  params
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale as Locale);

  const t = await getTranslations("common");

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <a className="skip-link" href="#main">
              {t("skipToContent")}
            </a>
            {children}
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
