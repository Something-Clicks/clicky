import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { ConsentBanner } from "@/components/consent";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: "Something Clicks", template: "%s | Something Clicks" },
  description:
    "See what's worth fixing on your website, why it matters, and what to do next.",
  applicationName: "Something Clicks",
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
