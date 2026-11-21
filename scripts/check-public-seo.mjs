// GET-only local smoke test of the generated HTML, without login or database setup.
import assert from "node:assert/strict";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, WEBSITE_JSON_LD } from "../lib/site-identity.ts";

const base = new URL(process.argv[2] || "http://localhost:5173");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "LOCAL_PREVIEW_ONLY");
const decode = text => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const tags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map(match =>
  Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)])));
const get = async path => {
  const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, path);
  assert.ok(!/noindex/i.test(response.headers.get("x-robots-tag") || ""));
  return response.text();
};
const home = await get("/");
assert.equal(decode(home.match(/<title>(.*?)<\/title>/s)?.[1] || ""), SITE_TITLE);
const meta = tags(home, "meta");
const oneMeta = (name, attribute = "name") => {
  const matches = meta.filter(tag => tag[attribute] === name);
  assert.equal(matches.length, 1, name);
  return matches[0].content;
};
assert.equal(oneMeta("description"), SITE_DESCRIPTION);
assert.equal(oneMeta("application-name"), SITE_NAME);
assert.equal(oneMeta("og:site_name", "property"), SITE_NAME);
assert.equal(new URL(oneMeta("og:url", "property")).href, `${SITE_URL}/`);
assert.equal(oneMeta("og:title", "property"), SITE_TITLE);
assert.equal(oneMeta("og:description", "property"), SITE_DESCRIPTION);
assert.equal(oneMeta("twitter:card"), "summary");
assert.equal(oneMeta("twitter:title"), SITE_TITLE);
assert.ok(!meta.some(tag => tag.name === "robots" && /noindex/i.test(tag.content)));
const canonical = html => tags(html, "link").filter(tag => tag.rel === "canonical").map(tag => new URL(tag.href).href);
assert.deepEqual(canonical(home), [`${SITE_URL}/`]);
const structured = [...home.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
assert.deepEqual(structured, [WEBSITE_JSON_LD]); // Only fixed public fields, no user data or fabricated ratings.
assert.match(home, /<h1\b[^>]*>DocenteTuc[^<]*<\/h1>/);
assert.ok(home.includes("Información útil") && home.includes("Capacitaciones"), "SSR_PUBLIC_CONTENT");
assert.ok(!home.includes('name="codex-preview"'));
const stylesheet = tags(home, "link").find(tag => tag.rel === "stylesheet")?.href;
const script = tags(home, "script").find(tag => tag.src)?.src;
for (const resource of [stylesheet, script]) {
  assert.ok(resource, "PUBLIC_RENDER_RESOURCE");
  assert.equal((await fetch(new URL(resource, base), { redirect: "manual" })).status, 200);
}
const robots = await get("/robots.txt");
assert.match(robots, /Allow: \/(?:\r?\n|$)/i);
assert.match(robots, /Disallow: \/api\//i);
assert.match(robots, /Disallow: \/admin/i);
assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`));
const paths = ["/", "/privacidad", "/eliminar-datos"];
const sitemap = await get("/sitemap.xml");
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]), paths.map(path => `${SITE_URL}${path}`));
for (const path of paths.slice(1)) assert.deepEqual(canonical(await get(path)), [`${SITE_URL}${path}`]);
const manifest = JSON.parse(await get("/manifest.webmanifest"));
assert.equal(manifest.name, SITE_NAME);
assert.equal(manifest.short_name, SITE_NAME);
assert.equal(manifest.description, SITE_DESCRIPTION);
assert.equal(manifest.start_url, "/");
const image = await fetch(new URL("/icon-512.png", base), { redirect: "manual" });
assert.equal(image.status, 200);
assert.match(image.headers.get("content-type") || "", /image\/png/);
console.log(JSON.stringify({ ok: true, localOnly: true, publicHtml: "SSR without JavaScript", canonical: `${SITE_URL}/`,
  sitemapUrls: paths.length, structuredData: "one public WebSite", privateData: "none added to metadata/JSON-LD" }));
