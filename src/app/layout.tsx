import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Something Clicks: an AI marketing partner for small businesses', description: 'Enter your website. See what to fix first, with the evidence, and get ready-to-use marketing work you approve.' };
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
