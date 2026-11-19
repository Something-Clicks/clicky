"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** "Good morning." in the visitor's own time zone (the server cannot know it). */
export function Greeting() {
  const hour = useSyncExternalStore(subscribe, () => new Date().getHours(), () => -1);
  const text = hour < 0 ? "Hello." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  return <>{text}</>;
}
