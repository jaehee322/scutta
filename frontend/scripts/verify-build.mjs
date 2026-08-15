import { access, readFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");

async function requireFile(relativePath) {
  const absolutePath = path.join(dist, relativePath);
  await access(absolutePath);
  return absolutePath;
}

const indexPath = await requireFile("index.html");
const manifestPath = await requireFile("manifest.webmanifest");
await requireFile("sw.js");

const index = await readFile(indexPath, "utf8");
if (!index.includes("manifest.webmanifest")) {
  throw new Error("index.html does not link the PWA manifest");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.display !== "standalone" || manifest.start_url !== "/" || manifest.scope !== "/") {
  throw new Error("PWA manifest has invalid display, start_url, or scope");
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
for (const requiredSize of ["192x192", "512x512"]) {
  const icon = icons.find((candidate) => candidate.sizes?.split(" ").includes(requiredSize));
  if (!icon?.src) {
    throw new Error(`PWA manifest is missing a ${requiredSize} icon`);
  }
  await requireFile(icon.src.replace(/^\//, ""));
}

console.log("PWA build verification passed");
