import type { Metadata } from "next";

import { NOINDEX } from "@/config/seo";

// The page itself is a client component, so its metadata lives here. Password pages are never search results.
export const metadata: Metadata = { title: "Reset your password", robots: NOINDEX };

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
