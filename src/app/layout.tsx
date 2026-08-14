import type { Metadata } from "next";
import "./globals.css";

import { appConfig } from "@/config/app";

export const metadata: Metadata = {
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
