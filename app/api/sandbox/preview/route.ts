import path from "node:path"

import { NextResponse } from "next/server"

import {
  getStartedDaytonaSandbox,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
} from "@/lib/daytona-sandbox"

export const runtime = "nodejs"

type PackageManager = "bun" | "pnpm" | "yarn" | "npm"
type DevFramework =
  | "astro"
  | "custom"
  | "next"
  | "nuxt"
  | "react-scripts"
  | "remix"
  | "vite"

type PackageManifest = {
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type DevServerCandidate = {
  framework: DevFramework
  runner: "script" | "vite-plus"
  packageDir: string
  packageManagerField?: string
  packagePath: string
  port: number
  score: number
  script: string
}

const SUPPORTED_PORTS = new Set([3000, 5173, 4321, 8000])
const DEV_SERVER_PIDFILE_PREFIX = ".cloudcode-dev-server"
const DEV_SERVER_STATE_FILENAME = `${DEV_SERVER_PIDFILE_PREFIX}-state.json`
const PACKAGE_JSON_FIND_COMMAND =
  "find . \\( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/.next/*' -o -path '*/dist/*' -o -path '*/build/*' -o -path '*/coverage/*' -o -path '*/.turbo/*' \\) -prune -o -name package.json -print | sort"
const INSTALL_COMMANDS: Record<PackageManager, string> = {
  bun: "bun install",
  npm: "npm install",
  pnpm: "pnpm install",
  yarn: "yarn install",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function parseManifest(content: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) return null
    return {
      dependencies: toStringRecord(parsed.dependencies),
      devDependencies: toStringRecord(parsed.devDependencies),
      packageManager:
        typeof parsed.packageManager === "string"
          ? parsed.packageManager
          : undefined,
      scripts: toStringRecord(parsed.scripts),
    }
  } catch {
    return null
  }
}

function normalizePackageJsonPath(packageJsonPath: string) {
  return packageJsonPath.replace(/^\.\//, "")
}

function normalizePackageDir(packageJsonPath: string) {
  const packageDir = path.posix.dirname(packageJsonPath)
  return packageDir === "." ? "." : packageDir
}

function formatPackagePath(packageDir: string) {
  return packageDir === "." ? "root" : packageDir
}

function extractExplicitPort(script: string) {
  const patterns = [
    /--port(?:=|\s+)(\d{2,5})/i,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})(?=$|\s)/i,
    /\bPORT=(\d{2,5})\b/i,
  ]

  for (const pattern of patterns) {
    const match = script.match(pattern)
    const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }

  return null
}

function getDependencyNames(manifest: PackageManifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
}

function detectFramework(
  manifest: PackageManifest,
  script: string
): DevFramework {
  const normalizedScript = script.toLowerCase()
  const dependencyNames = getDependencyNames(manifest)

  if (normalizedScript.includes("next dev") || dependencyNames.has("next")) {
    return "next"
  }
  if (normalizedScript.includes("astro") || dependencyNames.has("astro")) {
    return "astro"
  }
  if (
    normalizedScript.includes("vite") ||
    dependencyNames.has("@sveltejs/kit")
  ) {
    return "vite"
  }
  if (
    normalizedScript.includes("react-scripts") ||
    dependencyNames.has("react-scripts")
  ) {
    return "react-scripts"
  }
  if (
    normalizedScript.includes("remix") ||
    dependencyNames.has("@remix-run/dev")
  ) {
    return "remix"
  }
  if (normalizedScript.includes("nuxt") || dependencyNames.has("nuxt")) {
    return "nuxt"
  }

  return "custom"
}

function getDefaultPortForFramework(framework: DevFramework) {
  switch (framework) {
    case "astro":
      return 4321
    case "next":
    case "nuxt":
    case "react-scripts":
    case "remix":
      return 3000
    case "vite":
      return 5173
    default:
      return null
  }
}

function toSupportedPort(port: number | null | undefined) {
  return typeof port === "number" && SUPPORTED_PORTS.has(port) ? port : null
}

function isWorkspaceOrchestratorScript(script: string) {
  const normalized = script.toLowerCase()
  return [
    "turbo",
    " nx ",
    "nx ",
    "lerna",
    "concurrently",
    "npm-run-all",
    "wireit",
    "yarn workspaces",
    "pnpm -r",
    "pnpm --recursive",
    "npm -w",
    "npm --workspace",
  ].some((pattern) => normalized.includes(pattern))
}

function scoreCandidate(candidate: {
  framework: DevFramework
  packageDir: string
  port: number
  script: string
}) {
  const packageDirSegments = candidate.packageDir.toLowerCase().split("/")
  const packageName = packageDirSegments.at(-1) ?? ""
  const normalizedScript = candidate.script.toLowerCase()
  let score = 0
  if (candidate.framework !== "custom") score += 100
  if (SUPPORTED_PORTS.has(candidate.port)) score += 60
  if (candidate.packageDir.startsWith("apps/")) score += 30
  if (candidate.packageDir.startsWith("app/")) score += 20
  if (
    ["web", "webapp", "app", "client", "frontend", "site"].includes(packageName)
  ) {
    score += 80
  }
  if (["cli", "server", "api", "worker", "convex"].includes(packageName)) {
    score -= 120
  }
  if (/\b(node|tsx|ts-node|bun)\b/.test(normalizedScript)) score -= 80
  if (isWorkspaceOrchestratorScript(candidate.script)) score -= 120
  if (candidate.packageDir === ".") score -= 10
  return score - candidate.packageDir.split("/").length
}

function buildCandidate(
  manifest: PackageManifest,
  packageJsonPath: string
): DevServerCandidate | null {
  const script = manifest.scripts?.dev?.trim()
  if (!script) return null

  const framework = detectFramework(manifest, script)
  const dependencyNames = getDependencyNames(manifest)
  const runner =
    framework === "vite" &&
    dependencyNames.has("vite-plus") &&
    /^vite\s+dev\b/i.test(script)
      ? "vite-plus"
      : "script"
  const port =
    toSupportedPort(extractExplicitPort(script)) ??
    toSupportedPort(getDefaultPortForFramework(framework))
  if (port === null) return null

  const packageDir = normalizePackageDir(packageJsonPath)
  return {
    framework,
    runner,
    packageDir,
    packageManagerField: manifest.packageManager,
    packagePath: formatPackagePath(packageDir),
    port,
    score: scoreCandidate({ framework, packageDir, port, script }),
    script,
  }
}

function pickBestCandidate(candidates: DevServerCandidate[]) {
  const [candidate] = [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.packageDir.localeCompare(right.packageDir)
  })
  return candidate ?? null
}

function parsePackageManagerName(
  packageManagerField: string | undefined
): PackageManager | null {
  const [name] = packageManagerField?.split("@") ?? []
  return name === "bun" || name === "pnpm" || name === "yarn" || name === "npm"
    ? name
    : null
}

function getFrameworkArgs(framework: DevFramework, port: number) {
  switch (framework) {
    case "next":
      return ["--hostname", "0.0.0.0", "--port", String(port)]
    case "astro":
    case "nuxt":
    case "vite":
      return ["--host", "0.0.0.0", "--port", String(port)]
    default:
      return []
  }
}

function buildRunCommand(
  packageManager: PackageManager,
  framework: DevFramework,
  runner: DevServerCandidate["runner"],
  port: number
) {
  const extraArgs = getFrameworkArgs(framework, port).join(" ")

  if (runner === "vite-plus") {
    switch (packageManager) {
      case "bun":
        return `env BROWSER=none HOST=0.0.0.0 PORT=${port} bunx vp dev${extraArgs ? ` ${extraArgs}` : ""}`
      case "npm":
        return `env BROWSER=none HOST=0.0.0.0 PORT=${port} npx vp dev${extraArgs ? ` ${extraArgs}` : ""}`
      case "pnpm":
        return `env BROWSER=none HOST=0.0.0.0 PORT=${port} pnpm exec vp dev${extraArgs ? ` ${extraArgs}` : ""}`
      case "yarn":
        return `env BROWSER=none HOST=0.0.0.0 PORT=${port} yarn exec vp dev${extraArgs ? ` ${extraArgs}` : ""}`
    }
  }

  switch (packageManager) {
    case "bun":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} bun run dev${extraArgs ? ` -- ${extraArgs}` : ""}`
    case "npm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} npm run dev${extraArgs ? ` -- ${extraArgs}` : ""}`
    case "pnpm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} pnpm dev${extraArgs ? ` -- ${extraArgs}` : ""}`
    case "yarn":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} yarn dev${extraArgs ? ` ${extraArgs}` : ""}`
  }
}

function getPidFilePath(packageDirAbs: string, port: number) {
  return path.posix.join(
    packageDirAbs,
    `${DEV_SERVER_PIDFILE_PREFIX}-${port}.pid`
  )
}

function getStateFilePath(repoPath: string) {
  return path.posix.join(repoPath, DEV_SERVER_STATE_FILENAME)
}

async function shouldInstallFromRepoRoot({
  packageManager,
  repoPath,
  sandbox,
}: {
  packageManager: PackageManager
  repoPath: string
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>
}) {
  if (packageManager !== "pnpm") return false

  return Boolean(
    await readDaytonaTextFile(
      sandbox,
      path.posix.join(repoPath, "pnpm-workspace.yaml")
    ).catch(() => "")
  )
}

async function getRunningPid({
  packageDirAbs,
  pidFilePath,
  sandbox,
}: {
  packageDirAbs: string
  pidFilePath: string
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>
}) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      `PID_FILE=${shellQuote(pidFilePath)}`,
      'if [ ! -f "$PID_FILE" ]; then exit 1; fi',
      'PID=$(cat "$PID_FILE")',
      'case "$PID" in \'\'|*[!0-9]*) rm -f "$PID_FILE"; exit 1;; esac',
      'kill -0 "$PID" 2>/dev/null || { rm -f "$PID_FILE"; exit 1; }',
      'STAT=$(ps -o stat= -p "$PID" 2>/dev/null || true)',
      'case "$STAT" in *Z*) rm -f "$PID_FILE"; exit 1;; esac',
      "printf '%s' \"$PID\"",
    ].join("\n"),
    { cwd: packageDirAbs, timeoutMs: 5_000 }
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function checkPortReady({
  port,
  sandbox,
}: {
  port: number
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>
}) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      `PORT=${port}`,
      'URL="http://127.0.0.1:$PORT/"',
      "if command -v curl >/dev/null 2>&1; then",
      '  curl -sS --max-time 10 -o /dev/null "$URL"',
      "elif command -v wget >/dev/null 2>&1; then",
      '  wget -q -T 10 -O /dev/null "$URL"',
      "else",
      '  URL="$URL" node -e "fetch(process.env.URL, { signal: AbortSignal.timeout(10000) }).then(() => process.exit(0)).catch(() => process.exit(1))"',
      "fi",
      "if [ $? -eq 0 ]; then printf READY; else printf WAITING; fi",
    ].join("\n"),
    { timeoutMs: 12_000 }
  )
  return result.exitCode === 0 && result.stdout.trim() === "READY"
}

async function findCandidates(
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>,
  repoPath: string
) {
  const result = await runDaytonaCommand(sandbox, PACKAGE_JSON_FIND_COMMAND, {
    cwd: repoPath,
    timeoutMs: 30_000,
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to search for package.json files")
  }

  const packageJsonPaths = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizePackageJsonPath)
    .slice(0, 100)

  const candidates = await Promise.all(
    packageJsonPaths.map(async (packageJsonPath) => {
      try {
        const manifest = parseManifest(
          await readDaytonaTextFile(
            sandbox,
            path.posix.join(repoPath, packageJsonPath)
          )
        )
        return manifest ? buildCandidate(manifest, packageJsonPath) : null
      } catch {
        return null
      }
    })
  )

  return candidates.filter(
    (candidate): candidate is DevServerCandidate => candidate !== null
  )
}

export async function POST(request: Request) {
  let sandboxId = ""
  try {
    const body = (await request.json()) as { sandboxId?: unknown }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const { repoPath } = await resolveDaytonaPaths(sandbox)
    const target = pickBestCandidate(await findCandidates(sandbox, repoPath))
    if (!target) {
      return NextResponse.json(
        { error: "No supported dev script found in package.json files" },
        { status: 404 }
      )
    }

    const persisted = await readDaytonaTextFile(
      sandbox,
      getStateFilePath(repoPath)
    ).catch(() => "")
    const persistedTarget = persisted
      ? (JSON.parse(persisted) as { packageDir?: unknown; port?: unknown })
      : null

    if (
      typeof persistedTarget?.packageDir === "string" &&
      typeof persistedTarget.port === "number" &&
      persistedTarget.packageDir === target.packageDir &&
      persistedTarget.port === target.port
    ) {
      const packageDirAbs =
        persistedTarget.packageDir === "."
          ? repoPath
          : path.posix.join(repoPath, persistedTarget.packageDir)
      const pidFilePath = getPidFilePath(packageDirAbs, persistedTarget.port)
      const pid = await getRunningPid({ packageDirAbs, pidFilePath, sandbox })
      if (pid) {
        return NextResponse.json({
          packagePath: formatPackagePath(persistedTarget.packageDir),
          port: persistedTarget.port,
          url: await getDaytonaPreviewUrl(sandbox, persistedTarget.port),
        })
      }
    }

    const packageDirAbs =
      target.packageDir === "."
        ? repoPath
        : path.posix.join(repoPath, target.packageDir)
    const pidFilePath = getPidFilePath(packageDirAbs, target.port)
    const existingPid = await getRunningPid({
      packageDirAbs,
      pidFilePath,
      sandbox,
    })
    if (!existingPid) {
      const packageManager =
        parsePackageManagerName(target.packageManagerField) ?? "pnpm"
      const runCommand = buildRunCommand(
        packageManager,
        target.framework,
        target.runner,
        target.port
      )
      const installDirAbs = (await shouldInstallFromRepoRoot({
        packageManager,
        repoPath,
        sandbox,
      }))
        ? repoPath
        : packageDirAbs
      const installMarker = path.posix.join(
        installDirAbs,
        packageManager === "pnpm" ? "node_modules/.pnpm" : "node_modules"
      )
      const backgroundCommand = [
        `printf '%s' "$$" > ${shellQuote(pidFilePath)}`,
        `cd ${shellQuote(installDirAbs)}`,
        `[ -d ${shellQuote(installMarker)} ] || ${INSTALL_COMMANDS[packageManager]}`,
        `cd ${shellQuote(packageDirAbs)}`,
        `exec ${runCommand}`,
      ].join(" && ")
      const launchCommand = [
        `nohup sh -lc ${shellQuote(backgroundCommand)} > ${shellQuote(
          path.posix.join(
            packageDirAbs,
            `${DEV_SERVER_PIDFILE_PREFIX}-${target.port}.log`
          )
        )} 2>&1 < /dev/null &`,
      ].join("\n")

      await runDaytonaCommand(sandbox, launchCommand, {
        cwd: packageDirAbs,
        timeoutMs: 10_000,
      })
    }

    await runDaytonaCommand(
      sandbox,
      `printf '%s' ${shellQuote(
        JSON.stringify({ packageDir: target.packageDir, port: target.port })
      )} > ${shellQuote(getStateFilePath(repoPath))}`,
      { cwd: repoPath, timeoutMs: 5_000 }
    )

    return NextResponse.json({
      packagePath: target.packagePath,
      port: target.port,
      url: await getDaytonaPreviewUrl(sandbox, target.port),
    })
  } catch (error) {
    console.error("Failed to launch sandbox preview:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to launch sandbox preview",
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sandboxId = url.searchParams.get("sandboxId")?.trim()
  const port = Number.parseInt(url.searchParams.get("port") ?? "", 10)

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (!SUPPORTED_PORTS.has(port)) {
    return NextResponse.json(
      { error: "supported port required" },
      { status: 400 }
    )
  }

  try {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const ready = await checkPortReady({ port, sandbox })

    return NextResponse.json({
      ready,
      url: ready ? await getDaytonaPreviewUrl(sandbox, port) : undefined,
    })
  } catch (error) {
    console.error("Failed to check sandbox preview:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check sandbox preview",
      },
      { status: 500 }
    )
  }
}

async function getDaytonaPreviewUrl(
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>,
  port: number
) {
  const signed = await sandbox.getSignedPreviewUrl(port, 3600)
  return signed.url
}
