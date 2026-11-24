import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { ConsentBanner } from "@/components/consent";

import { DEFAULT_DESCRIPTION, PAGE_SEO, SITE_NAME, SITE_URL } from "@/config/seo";

/**
 * Defaults for every page. Canonical URLs and social cards always use the production domain
 * (SITE_URL), never a preview or local address. Public pages set their own metadata from
 * src/config/seo.ts; signed-in areas are noindex in their layouts.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: PAGE_SEO["/"].title, template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#fff9ef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US">
      <body>
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
