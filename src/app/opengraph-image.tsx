import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The social sharing card (Open Graph and Twitter) for every page: the approved 3D Clicky artwork
 * (public/brand/clicky-3d.png, built from brand-source by `pnpm icons`, never redrawn) and the name.
 * Built once at build time.
 */
export const alt = "Something Clicks: marketing help for small businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const art = await readFile(join(process.cwd(), "public/brand/clicky-3d.png"));
  const src = `data:image/png;base64,${art.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: "#fff9ef", padding: "0 72px" }}>
        <img src={src} width={380} height={252} alt="" />
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 48 }}>
          <div style={{ fontSize: 64, color: "#1f2433" }}>Something Clicks</div>
          <div style={{ fontSize: 32, color: "#2A5DAE", marginTop: 16 }}>Marketing help for small businesses</div>
        </div>
      </div>
    ),
    size,
  );
}
