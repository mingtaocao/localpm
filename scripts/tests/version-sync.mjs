import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { syncVersion } from "../sync-version.mjs";

function fixture(t, version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "localpm-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src-tauri"));
  const write = (path, value) => writeFileSync(join(root, path), value);
  const read = (path) => readFileSync(join(root, path), "utf8");
  write(
    "package.json",
    JSON.stringify({
      name: "local-postman",
      version,
      scripts: { version: "node scripts/sync-version.mjs" },
    }),
  );
  write(
    "package-lock.json",
    JSON.stringify({
      name: "local-postman",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "local-postman", version: "0.1.0" },
        "node_modules/dependency": { version: "0.1.0" },
      },
    }),
  );
  write(
    "src-tauri/tauri.conf.json",
    JSON.stringify({
      version: "0.1.0",
      identifier: "test.localpm",
      bundle: { active: true },
    }),
  );
  write(
    "src-tauri/Cargo.toml",
    '[package]\nname = "local-postman"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\ndependency = { version = "0.1.0" }\n',
  );
  write(
    "src-tauri/Cargo.lock",
    'version = 4\n\n[[package]]\nname = "dependency"\nversion = "0.1.0"\n\n[[package]]\nname = "local-postman"\nversion = "0.1.0"\ndependencies = ["dependency"]\n',
  );
  return { root, write, read };
}

test("syncs only app versions, supports prereleases and is idempotent", (t) => {
  const { root, read } = fixture(t, "1.2.3-beta.1+build.4");
  assert.equal(syncVersion(root).changed.length, 4);
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, "1.2.3-beta.1+build.4");
  assert.equal(lock.packages[""].version, lock.version);
  assert.equal(lock.packages["node_modules/dependency"].version, "0.1.0");
  assert.deepEqual(JSON.parse(read("src-tauri/tauri.conf.json")), {
    version: "../package.json",
    identifier: "test.localpm",
    bundle: { active: true },
  });
  assert.match(
    read("src-tauri/Cargo.toml"),
    /version = "1.2.3-beta.1\+build.4"/,
  );
  assert.match(
    read("src-tauri/Cargo.toml"),
    /dependency = \{ version = "0.1.0" \}/,
  );
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "dependency"\nversion = "0.1.0"/,
  );
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "local-postman"\nversion = "1.2.3-beta.1\+build.4"/,
  );
  assert.deepEqual(syncVersion(root).changed, []);
  assert.deepEqual(syncVersion(root, true).changed, []);
});

test("check mode reports drift without changing files", (t) => {
  const { root, read } = fixture(t);
  const before = read("package-lock.json");
  assert.throws(() => syncVersion(root, true), /out of sync/);
  assert.equal(read("package-lock.json"), before);
});

test("invalid versions and malformed targets fail before writing any files", (t) => {
  const { root, write, read } = fixture(t, "01.2.3");
  const before = read("package-lock.json");
  assert.throws(() => syncVersion(root), /valid semantic version/);
  write("package.json", '{"version":"1.2.3"}');
  write(
    "src-tauri/Cargo.lock",
    '[[package]]\nname = "unrelated"\nversion = "0.1.0"\n',
  );
  assert.throws(() => syncVersion(root), /exactly one app package/);
  assert.equal(read("package-lock.json"), before);
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, "0.1.0");
});

test("npm version runs the sync lifecycle without creating a tag", (t) => {
  const { root, read } = fixture(t, "1.2.3");
  mkdirSync(join(root, "scripts"));
  copyFileSync(
    new URL("../sync-version.mjs", import.meta.url),
    join(root, "scripts/sync-version.mjs"),
  );
  // npm_execpath is set by npm run test:version on Windows and Unix alike.
  assert.ok(process.env.npm_execpath);
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "version", "1.2.4", "--no-git-tag-version"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(read("package.json")).version, "1.2.4");
  assert.match(read("src-tauri/Cargo.toml"), /version = "1.2.4"/);
  assert.match(
    read("src-tauri/Cargo.lock"),
    /name = "local-postman"\nversion = "1.2.4"/,
  );
  assert.deepEqual(syncVersion(root, true).changed, []);
});
