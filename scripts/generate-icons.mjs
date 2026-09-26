import sharp from "../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js";

const source = "public/docentetuc-logo.png";

await sharp(source).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(source).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(source).resize(512, 512).png().toFile("public/icon-maskable-512.png");
await sharp(source).resize(64, 64).png().toFile("public/favicon.png");
await sharp(source).resize(512, 512).png().toFile("android/app/src/main/res/drawable/app_icon.png");
