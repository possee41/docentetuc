import sharp from "../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js";
import { mkdir } from "node:fs/promises";

const source = "public/docentetuc-logo.png";
const brand = "#062b55";
const roundedMask = (size, radius) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="white"/></svg>`);
const cutout = async (size) => sharp(source).extract({ left: 48, top: 48, width: 1158, height: 1158 }).resize(size, size)
  .composite([{ input: roundedMask(size, size * 0.21), blend: "dest-in" }]).png().toBuffer();
const output = async (path, size) => sharp(await cutout(size)).png().toFile(path);
const opaqueBrandIcon = async (path) => sharp({ create: { width: 512, height: 512, channels: 4, background: brand } })
  .composite([{ input: await cutout(512) }]).png().toFile(path);

await mkdir("android/app/src/main/res/mipmap", { recursive: true });
await mkdir("android/app/src/main/res/mipmap-anydpi-v26", { recursive: true });
await mkdir("android/app/src/main/res/drawable-nodpi", { recursive: true });

await output("public/icon-192.png", 192);
await output("public/icon-512.png", 512);
await output("public/favicon.png", 64);
await sharp({ create: { width: 512, height: 512, channels: 4, background: brand } })
  .composite([{ input: await sharp(await cutout(512)).resize(420, 420).png().toBuffer(), gravity: "centre" }])
  .png().toFile("public/icon-maskable-512.png");

const foreground = await sharp(await cutout(512)).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: foreground, gravity: "centre" }]).png()
  .toFile("android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png");
await output("android/app/src/main/res/drawable/app_icon.png", 512);
await opaqueBrandIcon("android/app/src/main/res/mipmap/ic_launcher.png");

await sharp(await cutout(1254)).webp({ quality: 88, effort: 6 }).toFile("public/docentetuc-logo.webp");
