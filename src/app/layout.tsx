import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata, Viewport } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: "Something Clicks: Make the complicated click.", template: "%s | Something Clicks" },
  description:
    "Know what is working, what needs attention, and what to do next. AI helps prepare the work. You stay in control.",
  applicationName: "Something Clicks",
};

export const viewport: Viewport = { themeColor: "#f7f9fc" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US">
      <body>{children}</body>
    </html>
  );
}
