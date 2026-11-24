/**
 * Builds every Clicky asset from the approved artwork in brand-source/:
 *   - Flat Clicky  (brand-source/flat-clicky.webp): favicon, app icons, small UI marks.
 *   - 3D Clicky    (brand-source/3d-clicky.webp):  homepage, onboarding, storytelling.
 * The two versions are never swapped.
 *
 * The artwork is never redrawn. The only operations are:
 *   1. Background removal: pixels connected to the image border whose color is
 *      close to white become transparent. Their alpha is recovered by
 *      "un-blending" from white, so anti-aliased edges and the soft shadow keep
 *      their exact appearance on any background.
 *   2. Cropping to the artwork and resizing.
 *
 * Run: pnpm icons
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLAT = join(root, "brand-source/flat-clicky.webp");
const THREE_D = join(root, "brand-source/3d-clicky.webp");
const BRAND = join(root, "public/brand");
const APP = join(root, "src/app");

/** A background pixel differs from white by at most this much in any channel. */
const TOLERANCE = 140;

async function removeBackground(source) {
  const { data, info } = await sharp(source).flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const deficit = (i) => Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]);

  // Flood fill from every border pixel through near-white pixels.
  const background = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop();
    if (background[p] || deficit(p * 3) > TOLERANCE) continue;
    background[p] = 1;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y < height - 1) stack.push(p + width);
  }

  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * 3;
    const o = p * 4;
    if (!background[p]) {
      out[o] = data[i];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i + 2];
      out[o + 3] = 255;
      continue;
    }
    // color = alpha * c + (1 - alpha) * white  →  recover alpha and c.
    const a = deficit(i) / 255;
    if (a < 2 / 255) continue; // fully transparent
    for (let ch = 0; ch < 3; ch++) {
      out[o + ch] = Math.max(0, Math.min(255, Math.round(255 - (255 - data[i + ch]) / a)));
    }
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png();
}

/** Square crop around the visible artwork, with even padding. */
async function squareCrop(png, paddingRatio) {
  const trimmed = await png.clone().trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.round(Math.max(width, height) * (1 + paddingRatio * 2));
  return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: trimmed.data, left: Math.round((side - width) / 2), top: Math.round((side - height) / 2) }])
    .png()
    .toBuffer();
}

async function sized(buffer, size, background) {
  let img = sharp(buffer).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) img = img.flatten({ background });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir(BRAND, { recursive: true });

// ── 3D Clicky: transparent cut-out for the homepage and onboarding ──
const threeD = await (await removeBackground(THREE_D)).toBuffer();
const threeDTrim = await sharp(threeD).trim({ threshold: 1 }).toBuffer();
await writeFile(join(BRAND, "clicky-3d.png"), await sharp(threeDTrim).resize({ width: 720, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer());
await writeFile(join(BRAND, "clicky-3d.webp"), await sharp(threeDTrim).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toBuffer());

// ── Flat Clicky: icons and small interface marks ──
// The supplied flat file is already transparent; background removal is a no-op on it.
const flat = await (await removeBackground(FLAT)).toBuffer();
const ui = await squareCrop(sharp(flat), 0.02);
const icon = await squareCrop(sharp(flat), 0.04);
for (const size of [48, 96, 192]) await writeFile(join(BRAND, `clicky-flat-${size}.png`), await sized(ui, size));

const CREAM = { r: 255, g: 249, b: 239 };
await writeFile(join(APP, "icon.png"), await sized(icon, 512));
await writeFile(join(APP, "apple-icon.png"), await sized(await squareCrop(sharp(flat), 0.12), 180, CREAM));
await writeFile(join(BRAND, "icon-192.png"), await sized(icon, 192));
await writeFile(join(BRAND, "icon-512.png"), await sized(icon, 512));
// Maskable: art inside the 80% safe zone on cream.
await writeFile(join(BRAND, "icon-maskable-512.png"), await sized(await squareCrop(sharp(flat), 0.2), 512, CREAM));
await writeFile(
  join(APP, "favicon.ico"),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await sized(icon, size) })))),
);
// Favicon previews for checking legibility at 16, 32 and 64 px.
for (const size of [16, 32, 64]) await writeFile(join(BRAND, `favicon-check-${size}.png`), await sized(icon, size));
console.log("Assets written to public/brand and src/app.");
