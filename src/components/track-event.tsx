"use client";

import { useEffect } from "react";

import { trackEvent } from "./consent";

/**
 * Fires one analytics event per browser session for a given name + key (so a refresh or a
 * re-render never counts twice). Labels only: never pass emails, names, website text or ids.
 *  - GA4 / Clarity: only after the visitor said Yes (trackEvent holds or drops it otherwise).
 *  - funnel: also counted in our own database through /api/track (no personal data, no cookies).
 */
export function TrackEvent({
  name,
  id = "",
  params,
  funnel = false,
}: {
  name: string;
  id?: string;
  params?: Record<string, string | number | boolean>;
  funnel?: boolean;
}) {
  useEffect(() => {
    const k = `sc_ev:${name}:${id}`;
    try {
      if (window.sessionStorage.getItem(k)) return;
      window.sessionStorage.setItem(k, "1");
    } catch {
      // Storage blocked: fire anyway (may repeat on refresh).
    }
    trackEvent(name, params);
    if (funnel) {
      void fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: name }), keepalive: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, id]);
  return null;
}
