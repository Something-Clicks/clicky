"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Analytics consent. Nothing loads until the visitor chooses Yes:
 *  - Google Analytics 4 (NEXT_PUBLIC_GA_MEASUREMENT_ID): page views without query strings,
 *    no Google signals, no ad personalization.
 *  - Microsoft Clarity (NEXT_PUBLIC_CLARITY_PROJECT_ID): heatmaps and recordings; elements
 *    marked data-clarity-mask (forms, results, drafts, the whole workspace) are masked.
 * The choice is kept in this browser (localStorage) and can be changed from the footer.
 */
const KEY = "sc_consent";
type Choice = "yes" | "no";
const GA = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
const CLARITY = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "";
export const analyticsConfigured = Boolean(GA || CLARITY);

function read(): Choice | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}
function write(v: Choice) {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
    __scAnalytics?: boolean;
    __scQueue?: [string, Record<string, string | number | boolean>][];
  }
}

/** Page path only: query strings can carry tokens (e.g. sign-in links), so they never leave the site. */
const safeLocation = () => `${window.location.origin}${window.location.pathname}`;

function loadAnalytics() {
  if (window.__scAnalytics) return;
  window.__scAnalytics = true;
  if (GA) {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA)}`;
    document.head.appendChild(s);
  }
  if (CLARITY) {
    const c = ((...args: unknown[]) => {
      (c.q = c.q ?? []).push(args);
    }) as NonNullable<Window["clarity"]>;
    window.clarity = c;
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY)}`;
    document.head.appendChild(s);
    window.clarity("consent");
  }
  // Events raised before analytics finished loading (a page can fire one before the choice is read).
  const queued = window.__scQueue ?? [];
  window.__scQueue = [];
  for (const [name, params] of queued) trackEvent(name, params);
}

/** Sends a GA4 page view (path only) when analytics is on. */
export function trackPageView() {
  if (window.__scAnalytics && window.gtag) {
    window.gtag("event", "page_view", { page_location: safeLocation(), page_title: document.title });
  }
}

/** A GA4 funnel event. Only labels: never emails, names, website text or drafts. */
export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}) {
  if (!analyticsConfigured) return;
  if (!window.__scAnalytics) {
    // Not loaded yet. Held in memory only; dropped if the visitor says No.
    (window.__scQueue = window.__scQueue ?? []).push([name, params]);
    return;
  }
  if (GA && window.gtag) window.gtag("event", name, { ...params, page_location: safeLocation() });
  if (CLARITY && window.clarity) window.clarity("event", name);
}

const RETURN_KEY = "sc_last_visit";
const RETURN_AFTER_MS = 12 * 60 * 60 * 1000;
/** After consent: a visit more than 12 hours after the last one in this browser counts as a return visit. */
function checkReturnVisit() {
  try {
    const last = Number(window.localStorage.getItem(RETURN_KEY) ?? 0);
    const now = Date.now();
    if (last && now - last > RETURN_AFTER_MS) {
      trackEvent("return_visit");
      void fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "return_visit" }), keepalive: true });
    }
    if (!last || now - last > RETURN_AFTER_MS) window.localStorage.setItem(RETURN_KEY, String(now));
  } catch {
    // Storage blocked: no return-visit count.
  }
}

export const OPEN_CONSENT = "sc:open-consent";

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const first = useRef(true);

  // Page views for client-side navigation (the first view is sent when analytics loads).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    trackPageView();
  }, [pathname]);

  useEffect(() => {
    if (!analyticsConfigured) return;
    const choice = read();
    if (choice === "yes") {
      loadAnalytics();
      trackPageView();
      checkReturnVisit();
    } else if (choice === null) {
      // Defer the state update out of the effect body.
      queueMicrotask(() => setOpen(true));
    }
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT, reopen);
  }, []);

  const decide = useCallback((v: Choice) => {
    const before = read();
    write(v);
    setOpen(false);
    if (v === "yes") {
      loadAnalytics();
      trackPageView();
      checkReturnVisit();
    } else if (before === "yes" && window.__scAnalytics) {
      // Already loaded: reload so nothing keeps running.
      window.location.reload();
    }
  }, []);

  if (!open) return null;
  return (
    <div className="consent" role="dialog" aria-labelledby="consent-title" aria-live="polite">
      <p id="consent-title">
        <b>Can we measure how people use this site?</b> We&apos;d use Google Analytics and Microsoft Clarity to see what
        helps and what gets in the way. Forms and your results stay hidden.{" "}
        <a href="/privacy" className="link">
          Privacy
        </a>
      </p>
      <div className="row">
        <button className="btn small" type="button" onClick={() => decide("yes")}>
          Yes
        </button>
        <button className="btn small light" type="button" onClick={() => decide("no")}>
          No thanks
        </button>
      </div>
    </div>
  );
}

export function ConsentSettingsButton() {
  if (!analyticsConfigured) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT))}>
      Cookie settings
    </button>
  );
}
