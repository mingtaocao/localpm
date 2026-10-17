import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

// package.json is the only authored version. Validate every target before writing.
export function syncVersion(root = projectRoot, check = false) {
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  const pkg = JSON.parse(read("package.json"));
  if (typeof pkg.version !== "string" || !semver.test(pkg.version)) {
    throw new Error("package.json must contain a valid semantic version.");
  }
  const updates = [];
  const update = (path, before, after) => {
    if (before !== after) updates.push({ path, content: after });
  };
  const lockBefore = read("package-lock.json");
  const lock = JSON.parse(lockBefore);
  if (!lock.packages?.[""])
    throw new Error("package-lock.json is missing its root package.");
  lock.version = lock.packages[""].version = pkg.version;
  update("package-lock.json", lockBefore, JSON.stringify(lock, null, 2) + "\n");

  const configBefore = read("src-tauri/tauri.conf.json");
  const config = JSON.parse(configBefore);
  // Tauri resolves this relative to src-tauri, for both app metadata and installers.
  config.version = "../package.json";
  update(
    "src-tauri/tauri.conf.json",
    configBefore,
    JSON.stringify(config, null, 2) + "\n",
  );

  const manifest = read("src-tauri/Cargo.toml");
  const section = manifest
    .split(/(?=^\[)/m)
    .find((block) => /^\[package\](?:\s|$)/.test(block));
  const name = section?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!section || !name || !/^version\s*=\s*"[^"]+"/m.test(section)) {
    throw new Error("Cargo.toml is missing its package name or version.");
  }
  update(
    "src-tauri/Cargo.toml",
    manifest,
    manifest.replace(
      section,
      section.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${pkg.version}"`),
    ),
  );

  const cargoLock = read("src-tauri/Cargo.lock");
  const packages = cargoLock.split(/(?=^\[\[package\]\])/m);
  let matches = 0;
  const nextLock = packages
    .map((block) => {
      if (block.match(/^name\s*=\s*"([^"]+)"/m)?.[1] !== name) return block;
      matches++;
      if (!/^version\s*=\s*"[^"]+"/m.test(block))
        throw new Error("Cargo.lock app version is missing.");
      return block.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${pkg.version}"`);
    })
    .join("");
  if (matches !== 1)
    throw new Error("Cargo.lock must contain exactly one app package.");
  update("src-tauri/Cargo.lock", cargoLock, nextLock);
  if (check && updates.length) {
    throw new Error(
      `Versions are out of sync: ${updates.map(({ path }) => path).join(", ")}. Run npm run version:sync.`,
    );
  }
  if (!check)
    for (const { path, content } of updates)
      writeFileSync(resolve(root, path), content);
  return { version: pkg.version, changed: updates.map(({ path }) => path) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const result = syncVersion(projectRoot, process.argv.includes("--check"));
    console.log(
      `Version ${result.version}: ${result.changed.length ? `synced ${result.changed.join(", ")}` : "all files in sync"}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
