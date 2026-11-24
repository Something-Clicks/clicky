import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Something Clicks",
    short_name: "Something Clicks",
    description: "Website marketing checks for small businesses: what to fix, why it matters, and what to do next.",
    start_url: "/app",
    display: "standalone",
    background_color: "#fff9ef",
    theme_color: "#3977d5",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
