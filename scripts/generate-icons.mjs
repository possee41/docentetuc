import sharp from "../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js";

const icon = (safe) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${safe ? 0 : 144}" fill="#17362d"/><path d="M142 132h142c67 0 120 54 120 124s-53 124-120 124H142V132Zm82 72v104h60c28 0 50-23 50-52s-22-52-50-52h-60Z" fill="#d9f36a"/></svg>`);

await sharp(icon(false)).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(icon(false)).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(icon(true)).resize(512, 512).png().toFile("public/icon-maskable-512.png");
