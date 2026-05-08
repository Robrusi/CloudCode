#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

import { Daytona, Image } from "@daytona/sdk"

const DEFAULT_SNAPSHOT_NAME = "cloudcode-batteries-included"
const DEFAULT_BASE_IMAGE = "mcr.microsoft.com/devcontainers/universal:2-linux"

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return

  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || line.trim().startsWith("#")) continue

    let value = match[2]
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function hasArg(name) {
  return process.argv.includes(name)
}

function intEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForSnapshotGone(daytona, name) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await daytona.snapshot.get(name)
      await sleep(2_000)
    } catch {
      return
    }
  }

  throw new Error(`Timed out waiting for snapshot ${name} to be deleted.`)
}

function cloudcodeImage(baseImage) {
  return Image.base(baseImage).dockerfileCommands([
    "USER root",
    "ENV DEBIAN_FRONTEND=noninteractive",
    "ENV FLUTTER_HOME=/opt/flutter",
    "ENV RUSTUP_HOME=/usr/local/rustup",
    "ENV CARGO_HOME=/usr/local/cargo",
    "ENV SWIFTLY_HOME_DIR=/opt/swiftly",
    "ENV SWIFTLY_BIN_DIR=/usr/local/bin",
    "ENV SWIFTLY_TOOLCHAINS_DIR=/opt/swiftly/toolchains",
    'ENV PATH="/root/.vite-plus/bin:/root/.local/bin:/root/.local/share/pnpm:/root/.bun/bin:/root/.cargo/bin:/root/go/bin:/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/cargo/bin:/opt/kotlinc/bin:/usr/local/bin:/usr/local/share/npm-global/bin:$PATH"',
    "RUN find /etc/apt/sources.list.d -type f -iname '*yarn*' -delete || true",
    "RUN sed -i '/dl.yarnpkg.com/d' /etc/apt/sources.list || true",
    [
      "RUN apt-get update",
      "&& apt-get install -y --no-install-recommends",
      "bash",
      "bat",
      "build-essential",
      "ca-certificates",
      "clang",
      "cmake",
      "curl",
      "default-mysql-client",
      "dnsutils",
      "fd-find",
      "file",
      "git",
      "git-lfs",
      "gnupg",
      "iproute2",
      "jq",
      "less",
      "libcurl4-openssl-dev",
      "libedit-dev",
      "libgtk-3-dev",
      "libicu-dev",
      "liblzma-dev",
      "libncurses-dev",
      "libxml2-dev",
      "libz3-dev",
      "make",
      "nano",
      "ninja-build",
      "openssh-client",
      "pkg-config",
      "postgresql-client",
      "python3",
      "python3-dev",
      "python3-pip",
      "python3-venv",
      "redis-tools",
      "ripgrep",
      "rsync",
      "shellcheck",
      "sqlite3",
      "sudo",
      "tar",
      "tmux",
      "tree",
      "unzip",
      "vim",
      "wget",
      "xz-utils",
      "zlib1g-dev",
      "zip",
      "&& rm -rf /var/lib/apt/lists/*",
    ].join(" "),
    "RUN if [ -x /bin/bash ] && command -v usermod >/dev/null 2>&1; then usermod -s /bin/bash root || true; fi",
    "RUN [ -f /etc/profile.d/rvm.sh ] && mv /etc/profile.d/rvm.sh /etc/profile.d/rvm.sh.cloudcode-disabled || true",
    "RUN if command -v corepack >/dev/null 2>&1; then corepack enable; fi",
    [
      "RUN curl -fsSL https://vite.plus",
      "| env HOME=/root VP_NODE_MANAGER=yes bash",
      "&& vp --version",
    ].join(" "),
    [
      "RUN curl -fsSL https://bun.sh/install",
      "| env BUN_INSTALL=/root/.bun bash",
      "&& /root/.bun/bin/bun --version",
    ].join(" "),
    [
      "RUN if command -v npm >/dev/null 2>&1; then",
      "npm install -g --force",
      "@openai/codex@latest",
      "pnpm@latest",
      "typescript@latest",
      "tsx@latest;",
      "fi",
    ].join(" "),
    [
      "RUN for dir in /root/.vite-plus/bin /root/.bun/bin; do",
      '[ -d "$dir" ] || continue;',
      'for bin in "$dir"/*; do',
      '[ -e "$bin" ] || continue;',
      'ln -sf "$bin" "/usr/local/bin/$(basename "$bin")";',
      "done;",
      "done",
      "&& command -v vp",
      "&& command -v codex",
      "&& command -v pnpm",
      "&& command -v bun",
    ].join(" "),
    [
      "RUN curl -LsSf https://astral.sh/uv/install.sh",
      "| env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh",
      "|| true",
    ].join(" "),
    [
      "RUN curl https://mise.run",
      "| env MISE_INSTALL_PATH=/usr/local/bin/mise sh",
      "|| true",
    ].join(" "),
    [
      "RUN curl -fsSL https://sh.rustup.rs",
      "| sh -s -- -y --profile minimal --default-toolchain stable",
      "&& chmod -R a+rwX /usr/local/rustup /usr/local/cargo",
      "&& rustc --version && cargo --version",
    ].join(" "),
    [
      "RUN git clone --depth 1 --branch stable https://github.com/flutter/flutter.git /opt/flutter",
      "&& git config --system --add safe.directory /opt/flutter",
      "&& chmod -R a+rX /opt/flutter",
      "&& flutter config --no-analytics",
      "&& dart --disable-analytics",
      "&& flutter precache --linux --web",
      "&& chmod -R a+rwX /opt/flutter",
      "&& ln -sf /opt/flutter/bin/flutter /usr/local/bin/flutter",
      "&& ln -sf /opt/flutter/bin/dart /usr/local/bin/dart",
      "&& flutter --version",
      "&& dart --version",
    ].join(" "),
    [
      "RUN KOTLIN_URL=$(curl -fsSL https://api.github.com/repos/JetBrains/kotlin/releases/latest",
      "| jq -r '.assets[] | select(.name | test(\"^kotlin-compiler-.*\\\\.zip$\")) | .browser_download_url'",
      "| head -1)",
      '&& test -n "$KOTLIN_URL"',
      '&& curl -fsSL "$KOTLIN_URL" -o /tmp/kotlin-compiler.zip',
      "&& unzip -q /tmp/kotlin-compiler.zip -d /opt",
      "&& rm /tmp/kotlin-compiler.zip",
      "&& ln -sf /opt/kotlinc/bin/kotlin /usr/local/bin/kotlin",
      "&& ln -sf /opt/kotlinc/bin/kotlinc /usr/local/bin/kotlinc",
      "&& kotlinc -version",
    ].join(" "),
    [
      'RUN curl -O "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"',
      '&& tar zxf "swiftly-$(uname -m).tar.gz"',
      "&& ./swiftly init --quiet-shell-followup --no-modify-profile",
      "&& swift --version",
      '&& rm -f "swiftly-$(uname -m).tar.gz" swiftly',
    ].join(" "),
    "WORKDIR /workspace",
  ])
}

loadEnvFile(".env")
loadEnvFile(".env.local")

const name =
  argValue("--name") ||
  process.env.DAYTONA_CLOUDCODE_SNAPSHOT ||
  process.env.DAYTONA_DEFAULT_SNAPSHOT ||
  DEFAULT_SNAPSHOT_NAME
const baseImage =
  argValue("--base-image") ||
  process.env.DAYTONA_CLOUDCODE_BASE_IMAGE ||
  process.env.DAYTONA_DEFAULT_IMAGE ||
  DEFAULT_BASE_IMAGE
const rebuild =
  hasArg("--rebuild") || process.env.DAYTONA_CLOUDCODE_REBUILD === "1"

if (!process.env.DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY is required.")
  process.exit(1)
}

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET,
})

let existingSnapshot
try {
  existingSnapshot = await daytona.snapshot.get(name)
} catch {
  existingSnapshot = undefined
}

if (existingSnapshot) {
  if (existingSnapshot.state === "error" || rebuild) {
    console.log(
      `Deleting ${existingSnapshot.state} snapshot ${existingSnapshot.name} before rebuilding...`
    )
    await daytona.snapshot.delete(existingSnapshot)
    await waitForSnapshotGone(daytona, existingSnapshot.name)
  } else {
    console.log(
      `Snapshot already exists: ${existingSnapshot.name} (${existingSnapshot.state})`
    )
    console.log(`Set DAYTONA_DEFAULT_SNAPSHOT=${existingSnapshot.name}`)
    process.exit(0)
  }
}

console.log(`Creating Daytona snapshot "${name}" from ${baseImage}...`)
console.log("This is a one-time build; future sandboxes should use the snapshot.")

const createParams = {
  image: cloudcodeImage(baseImage),
  name,
  resources: {
    cpu: intEnv(
      "DAYTONA_CLOUDCODE_SNAPSHOT_CPU",
      intEnv("DAYTONA_SANDBOX_CPU", 2)
    ),
    disk: intEnv(
      "DAYTONA_CLOUDCODE_SNAPSHOT_DISK",
      intEnv("DAYTONA_SANDBOX_DISK", 10)
    ),
    memory: intEnv(
      "DAYTONA_CLOUDCODE_SNAPSHOT_MEMORY",
      intEnv("DAYTONA_SANDBOX_MEMORY", 4)
    ),
  },
}
const createOptions = {
  onLogs: (chunk) => process.stdout.write(chunk),
  timeout: Number(process.env.DAYTONA_CLOUDCODE_SNAPSHOT_TIMEOUT ?? 0),
}

let snapshot
try {
  snapshot = await daytona.snapshot.create(createParams, createOptions)
} catch (error) {
  if (error?.statusCode !== 409) throw error
  console.log("Snapshot name is still settling after deletion; retrying...")
  await waitForSnapshotGone(daytona, name)
  snapshot = await daytona.snapshot.create(createParams, createOptions)
}

console.log(`\nSnapshot ready: ${snapshot.name} (${snapshot.state})`)
console.log(`Set DAYTONA_DEFAULT_SNAPSHOT=${snapshot.name}`)
