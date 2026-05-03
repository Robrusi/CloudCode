import { Sandbox } from "e2b"

const CODEX_HOME = "/home/user/.codex"
const REPO_PATH = "/home/user/repo"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"
const CODEX_LAUNCHER_PATH = "/tmp/cloudcode-codex-latest"
const EXIT_MARKER = "__CLOUDCODE_CODEX_EXIT__"
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_SANDBOX_LIFETIME_MS = 60 * 60 * 1000
const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000
const BRANCH_CITIES = [
  "abu-dhabi",
  "accra",
  "adelaide",
  "alexandria",
  "algiers",
  "amsterdam",
  "ankara",
  "antwerp",
  "athens",
  "atlanta",
  "auckland",
  "austin",
  "baltimore",
  "barcelona",
  "bangkok",
  "beijing",
  "beirut",
  "belfast",
  "belgrade",
  "bergen",
  "berlin",
  "bilbao",
  "birmingham",
  "boston",
  "bogota",
  "bologna",
  "bratislava",
  "brighton",
  "brisbane",
  "bristol",
  "brussels",
  "bucharest",
  "budapest",
  "buenos-aires",
  "cairo",
  "calgary",
  "cape-town",
  "cardiff",
  "casablanca",
  "charlotte",
  "chengdu",
  "chicago",
  "cologne",
  "copenhagen",
  "dallas",
  "delhi",
  "denver",
  "detroit",
  "doha",
  "dublin",
  "dubai",
  "edinburgh",
  "florence",
  "frankfurt",
  "geneva",
  "glasgow",
  "gothenburg",
  "granada",
  "guadalajara",
  "guangzhou",
  "hamburg",
  "helsinki",
  "hong-kong",
  "honolulu",
  "houston",
  "istanbul",
  "jakarta",
  "jerusalem",
  "johannesburg",
  "kansas-city",
  "karachi",
  "krakow",
  "kyoto",
  "lagos",
  "las-vegas",
  "lausanne",
  "leipzig",
  "lima",
  "lisbon",
  "london",
  "los-angeles",
  "lyon",
  "madrid",
  "manchester",
  "manila",
  "marseille",
  "melbourne",
  "mexico-city",
  "miami",
  "milan",
  "minneapolis",
  "monaco",
  "montreal",
  "mumbai",
  "munich",
  "nairobi",
  "naples",
  "nashville",
  "new-orleans",
  "new-york",
  "nice",
  "oakland",
  "osaka",
  "oslo",
  "ottawa",
  "paris",
  "philadelphia",
  "phoenix",
  "portland",
  "porto",
  "prague",
  "quito",
  "rio-de-janeiro",
  "rome",
  "rotterdam",
  "san-antonio",
  "san-diego",
  "san-francisco",
  "san-jose",
  "san-juan",
  "santiago",
  "sao-paulo",
  "seattle",
  "seoul",
  "seville",
  "shanghai",
  "shenzhen",
  "singapore",
  "sofia",
  "stockholm",
  "sydney",
  "taipei",
  "tallinn",
  "tbilisi",
  "tel-aviv",
  "thessaloniki",
  "tokyo",
  "toronto",
  "toulouse",
  "tunis",
  "turin",
  "valencia",
  "vancouver",
  "venice",
  "vienna",
  "vilnius",
  "warsaw",
  "wellington",
  "zagreb",
  "zurich",
] as const

type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

export type CodexSpeed = "standard" | "fast"

export type RunCodexLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

export type RunCodexLog = {
  detail?: string
  kind: RunCodexLogKind
  message: string
}

export type RunCodexInSandboxInput = {
  authJson: string
  baseBranch?: string
  branchName?: string
  codexThreadId?: string
  githubToken?: string
  onLog?: (log: RunCodexLog) => void | Promise<void>
  model?: string
  previousDiff?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  resumeContext?: string
  repoUrl: string
  sandboxId?: string
  speed?: CodexSpeed
  timeoutMs?: number
}

export type RunCodexInSandboxResult = {
  branchName: string
  codexThreadId?: string
  diff: string
  exitCode: number
  lastMessage: string
  repoUrl: string
  sandboxId: string
  stderr: string
  status: string
  stdout: string
  updatedAuthJson: string
  recoveredSandbox: boolean
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function parseModel(model?: string) {
  const normalized = model?.trim()

  if (!normalized) {
    return undefined
  }

  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(normalized)) {
    throw new Error("Model contains unsupported characters.")
  }

  return normalized
}

function parseReasoningEffort(effort?: string): ReasoningEffort | undefined {
  if (
    effort === "none" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh"
  ) {
    return effort
  }

  if (effort) {
    throw new Error(
      "reasoningEffort must be none, low, medium, high, or xhigh."
    )
  }

  return undefined
}

function parseSpeed(speed?: string): CodexSpeed {
  if (!speed || speed === "standard") {
    return "standard"
  }

  if (speed === "fast") {
    return speed
  }

  throw new Error("speed must be standard or fast.")
}

function parseRepoUrl(repoUrl: string) {
  const normalized = repoUrl.trim()

  if (!normalized) {
    throw new Error("repoUrl is required.")
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("repoUrl must be an http(s) Git URL.")
    }
  } catch {
    throw new Error("repoUrl must be a valid Git URL.")
  }

  return normalized
}

function parseGitRef(value: string | undefined, label: string) {
  const normalized = value?.trim()

  if (!normalized) {
    return undefined
  }

  if (
    normalized.startsWith("-") ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    !/^[a-zA-Z0-9._/-]{1,120}$/.test(normalized)
  ) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

function defaultBranchName() {
  const city = BRANCH_CITIES[Math.floor(Math.random() * BRANCH_CITIES.length)]

  return `cloudcode/${city}`
}

function shuffledCityBranchNames(preferred: string) {
  const branchNames = BRANCH_CITIES.map((city) => `cloudcode/${city}`)

  for (let index = branchNames.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[branchNames[index], branchNames[randomIndex]] = [
      branchNames[randomIndex],
      branchNames[index],
    ]
  }

  return [
    preferred,
    ...branchNames.filter((branchName) => branchName !== preferred),
  ]
}

function defaultBranchNameWithSuffix() {
  const city = BRANCH_CITIES[Math.floor(Math.random() * BRANCH_CITIES.length)]
  const suffix = Math.random().toString(36).slice(2, 8)

  return `cloudcode/${city}-${suffix}`
}

async function createSandbox(timeoutMs: number) {
  return await Sandbox.create("codex", {
    timeoutMs: Math.max(timeoutMs, DEFAULT_SANDBOX_LIFETIME_MS),
  })
}

async function createBranch(
  sandbox: Awaited<ReturnType<typeof createSandbox>>,
  input: RunCodexInSandboxInput,
  branchName: string
) {
  await emitLog(input, {
    kind: "command",
    message: `git checkout -b ${branchName}`,
  })
  await sandbox.git.createBranch(REPO_PATH, branchName)
}

async function createDefaultBranch(
  sandbox: Awaited<ReturnType<typeof createSandbox>>,
  input: RunCodexInSandboxInput,
  branchName: string
) {
  let lastError: unknown

  for (const candidate of shuffledCityBranchNames(branchName)) {
    try {
      await createBranch(sandbox, input, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = defaultBranchNameWithSuffix()

    try {
      await createBranch(sandbox, input, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to create a default branch.")
}

async function connectOrCreateSandbox(
  sandboxId: string | undefined,
  timeoutMs: number
) {
  if (!sandboxId) {
    return { recoveredSandbox: false, sandbox: await createSandbox(timeoutMs) }
  }

  try {
    return {
      recoveredSandbox: false,
      sandbox: await Sandbox.connect(sandboxId),
    }
  } catch {
    return { recoveredSandbox: true, sandbox: await createSandbox(timeoutMs) }
  }
}

async function readLastMessage(sandbox: Sandbox) {
  try {
    return (await sandbox.files.read(LAST_MESSAGE_PATH)).trim()
  } catch {
    return ""
  }
}

async function getCodexExecHelp(sandbox: Sandbox) {
  try {
    return (
      await sandbox.commands.run(`${CODEX_LAUNCHER_PATH} exec --help`, {
        timeoutMs: 10_000,
      })
    ).stdout
  } catch {
    return ""
  }
}

async function getCodexResumeHelp(sandbox: Sandbox) {
  try {
    return (
      await sandbox.commands.run(`${CODEX_LAUNCHER_PATH} exec resume --help`, {
        timeoutMs: 10_000,
      })
    ).stdout
  } catch {
    return ""
  }
}

async function updateCodexCli(sandbox: Sandbox, input: RunCodexInSandboxInput) {
  await emitLog(input, {
    kind: "setup",
    message: "Updating Codex CLI to latest",
  })

  const updateCommand = [
    "set -e",
    "if command -v npm >/dev/null 2>&1; then",
    "  npm install -g @openai/codex@latest",
    "elif command -v bun >/dev/null 2>&1; then",
    "  bun install -g @openai/codex@latest",
    "else",
    "  echo 'Neither npm nor bun is available to install the latest Codex CLI.' >&2",
    "  exit 1",
    "fi",
    `cat > ${CODEX_LAUNCHER_PATH} <<'EOF'`,
    "#!/usr/bin/env bash",
    "set -e",
    'exec codex "$@"',
    "EOF",
    `chmod +x ${CODEX_LAUNCHER_PATH}`,
    `${CODEX_LAUNCHER_PATH} --version`,
  ].join("\n")

  await emitLog(input, {
    kind: "command",
    message: "npm install -g @openai/codex@latest",
    detail: "runs once when this app thread initializes its sandbox",
  })

  const result = await sandbox.commands.run(
    `bash -lc ${shellQuote(updateCommand)}`,
    {
      onStderr: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) {
          void input.onLog?.({ kind: "stderr", message: trimmed })
        }
      },
      onStdout: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) {
          void input.onLog?.({ kind: "stdout", message: trimmed })
        }
      },
      timeoutMs: CODEX_UPDATE_TIMEOUT_MS,
    }
  )

  const version =
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) || "Codex CLI updated"

  await emitLog(input, {
    kind: "setup",
    message: version,
  })
}

async function isCodexLauncherReady(sandbox: Sandbox) {
  try {
    const result = await sandbox.commands.run(
      `test -x ${CODEX_LAUNCHER_PATH}`,
      {
        timeoutMs: 10_000,
      }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

async function emitLog(input: RunCodexInSandboxInput, log: RunCodexLog) {
  await input.onLog?.(log)
}

function compactLine(value: string, max = 220) {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readableCodexText(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    const nested = findString(parsed, ["detail", "message", "error"])
    return nested && nested !== value ? readableCodexText(nested) : value
  } catch {
    return value
  }
}

function codexThreadIdFromEvent(event: unknown) {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)
  const threadId = stringValue(record.thread_id)
  return type === "thread.started" ? threadId : undefined
}

function findString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  const record = objectRecord(value)
  if (!record || depth > 3) return undefined

  for (const key of keys) {
    const found = stringValue(record[key])
    if (found) return found
  }

  for (const nested of Object.values(record)) {
    const found = findString(nested, keys, depth + 1)
    if (found) return found
  }

  return undefined
}

function summarizeCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)?.toLowerCase() ?? ""
  const status = stringValue(record.status)
  const command = findString(record, ["command", "cmd", "shell_command"])
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
  ])

  if (type.includes("reason")) {
    return {
      kind: "reasoning",
      message: text ? compactLine(readableCodexText(text)) : "Reasoning",
    }
  }

  if (
    command &&
    (type.includes("command") ||
      type.includes("exec") ||
      type.includes("tool") ||
      type.includes("function"))
  ) {
    return {
      kind: "command",
      message: compactLine(command),
      detail: status,
    }
  }

  if (type.includes("turn") && (type.includes("start") || status)) {
    return {
      kind: "setup",
      message: status ? `Codex turn ${status}` : "Codex turn started",
    }
  }

  if (type.includes("error")) {
    return {
      kind: "stderr",
      message: text
        ? compactLine(readableCodexText(text))
        : "Codex reported an error",
    }
  }

  return undefined
}

function createStdoutLogger(
  onLog: RunCodexInSandboxInput["onLog"],
  onCodexThreadId: (threadId: string) => void
) {
  let buffer = ""

  function emitPlainLine(line: string) {
    const trimmed = compactLine(line)
    if (!trimmed || trimmed.startsWith(EXIT_MARKER)) return
    void onLog?.({ kind: "stdout", message: trimmed })
  }

  function flushLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const event = JSON.parse(trimmed) as unknown
      const threadId = codexThreadIdFromEvent(event)
      if (threadId) onCodexThreadId(threadId)
      const summary = summarizeCodexEvent(event)
      if (summary) void onLog?.(summary)
    } catch {
      emitPlainLine(trimmed)
    }
  }

  return {
    chunk(data: string) {
      buffer += data
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) flushLine(line)
    },
    flush() {
      if (buffer) flushLine(buffer)
      buffer = ""
    },
  }
}

function redactAuthPathOutput(result: CommandResult) {
  const exitPattern = new RegExp(`\\n?${EXIT_MARKER}(\\d+)\\s*$`)
  const exitMatch = result.stdout.match(exitPattern)
  const exitCode = exitMatch?.[1] ? Number(exitMatch[1]) : result.exitCode

  return {
    ...result,
    exitCode,
    stderr: result.stderr.replaceAll(CODEX_HOME, "$CODEX_HOME"),
    stdout: result.stdout
      .replace(exitPattern, "")
      .replaceAll(CODEX_HOME, "$CODEX_HOME"),
  }
}

function restoredConversationPrompt(context: string, prompt: string) {
  return [
    "The previous sandbox expired, so this is a fresh sandbox. The saved git diff has already been applied. Use this handoff as the current task state and continue from it.",
    context.trim(),
    "Current user request:",
    prompt,
  ].join("\n\n")
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseModel(input.model)
  const reasoningEffort = parseReasoningEffort(input.reasoningEffort)
  const repoUrl = parseRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const requestedBranchName = parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim() || process.env.GITHUB_TOKEN
  const speed = parseSpeed(input.speed)
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  const existingCodexThreadId = parseGitRef(
    input.codexThreadId,
    "codexThreadId"
  )
  await emitLog(input, {
    kind: "setup",
    message: input.sandboxId ? "Connecting to sandbox" : "Creating sandbox",
  })
  const { recoveredSandbox, sandbox } = await connectOrCreateSandbox(
    input.sandboxId,
    timeoutMs
  )
  await emitLog(input, {
    kind: "setup",
    message: recoveredSandbox
      ? "Recovered with a fresh sandbox"
      : "Sandbox ready",
    detail: sandbox.sandboxId,
  })
  await sandbox.setTimeout(
    Math.max(timeoutMs + 60_000, DEFAULT_SANDBOX_LIFETIME_MS)
  )

  try {
    const codexThreadIdToResume =
      input.sandboxId && !recoveredSandbox ? existingCodexThreadId : undefined
    const shouldRestoreConversation = Boolean(
      existingCodexThreadId && !codexThreadIdToResume
    )
    const prompt =
      shouldRestoreConversation && input.resumeContext?.trim()
        ? restoredConversationPrompt(input.resumeContext, input.prompt)
        : input.prompt
    const needsCodexSetup =
      !input.sandboxId ||
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input)
    }
    await emitLog(input, { kind: "setup", message: "Preparing Codex auth" })
    await sandbox.commands.run(
      `mkdir -p ${CODEX_HOME} && chmod 700 ${CODEX_HOME}`
    )
    await sandbox.files.write(`${CODEX_HOME}/auth.json`, input.authJson)
    await sandbox.files.write(PROMPT_PATH, prompt)
    await sandbox.commands.run(
      `chmod 600 ${CODEX_HOME}/auth.json ${PROMPT_PATH}`
    )

    if (!input.sandboxId || recoveredSandbox) {
      await emitLog(input, {
        kind: "command",
        message: `git clone ${repoUrl}`,
        detail: baseBranch ? `branch ${baseBranch}` : undefined,
      })
      await sandbox.git.clone(repoUrl, {
        branch: baseBranch,
        depth: 1,
        password: githubToken,
        path: REPO_PATH,
        username: githubToken ? "x-access-token" : undefined,
      })
      if (requestedBranchName) {
        await createBranch(sandbox, input, requestedBranchName)
      } else {
        branchName = await createDefaultBranch(sandbox, input, branchName)
      }
      if (input.previousDiff?.trim()) {
        await emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        })
        await sandbox.files.write(PREVIOUS_DIFF_PATH, input.previousDiff)
        await sandbox.commands.run(
          `git -C ${REPO_PATH} apply --whitespace=nowarn ${PREVIOUS_DIFF_PATH}`,
          {
            timeoutMs: 60_000,
          }
        )
      }
    } else {
      await emitLog(input, {
        kind: "command",
        message: `test -d ${REPO_PATH}/.git`,
      })
      await sandbox.commands.run(`test -d ${REPO_PATH}/.git`, {
        timeoutMs: 10_000,
      })
    }

    await emitLog(input, {
      kind: "setup",
      message: "Reading Codex CLI capabilities",
    })
    const help = await getCodexExecHelp(sandbox)
    const resumeHelp = codexThreadIdToResume
      ? await getCodexResumeHelp(sandbox)
      : ""
    const modelFlag =
      model && (helpIncludes(help, "--model") || helpIncludes(help, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const resumeModelFlag =
      model &&
      resumeHelp &&
      (helpIncludes(resumeHelp, "--model") || helpIncludes(resumeHelp, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const configFlags = [
      reasoningEffort && helpIncludes(help, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(help, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeConfigFlags = [
      reasoningEffort && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const optionalFlags = [
      helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      !helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox") &&
      helpIncludes(help, "--sandbox")
        ? "--sandbox danger-full-access"
        : "",
      helpIncludes(help, "--full-auto") ? "--full-auto" : "",
      helpIncludes(help, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(help, "--ignore-user-config") ? "--ignore-user-config" : "",
      helpIncludes(help, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(help, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeOptionalFlags = [
      helpIncludes(resumeHelp, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      helpIncludes(resumeHelp, "--full-auto") ? "--full-auto" : "",
      helpIncludes(resumeHelp, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(resumeHelp, "--ignore-user-config")
        ? "--ignore-user-config"
        : "",
      helpIncludes(resumeHelp, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(resumeHelp, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const outputFlag = helpIncludes(help, "--output-last-message")
      ? `--output-last-message ${LAST_MESSAGE_PATH}`
      : ""
    const resumeOutputFlag = helpIncludes(resumeHelp, "--output-last-message")
      ? `--output-last-message ${LAST_MESSAGE_PATH}`
      : ""
    const cdFlag =
      helpIncludes(help, "--cd") || helpIncludes(help, "-C,")
        ? `-C ${REPO_PATH}`
        : ""
    const cdCommand = cdFlag ? "" : `cd ${REPO_PATH} &&`
    const codexCommand = codexThreadIdToResume
      ? [
          `cd ${REPO_PATH} &&`,
          `CODEX_HOME=${CODEX_HOME}`,
          `${CODEX_LAUNCHER_PATH} exec resume`,
          resumeOptionalFlags,
          resumeConfigFlags,
          resumeModelFlag,
          resumeOutputFlag,
          shellQuote(codexThreadIdToResume),
          "-",
          `< ${PROMPT_PATH}`,
        ]
          .filter(Boolean)
          .join(" ")
      : [
          cdCommand,
          `CODEX_HOME=${CODEX_HOME}`,
          `${CODEX_LAUNCHER_PATH} exec`,
          optionalFlags,
          configFlags,
          modelFlag,
          outputFlag,
          cdFlag,
          `< ${PROMPT_PATH}`,
        ]
          .filter(Boolean)
          .join(" ")
    const command = shellQuote(
      [
        "set +e",
        codexCommand,
        "code=$?",
        `printf '\\n${EXIT_MARKER}%s\\n' \"$code\"`,
        "exit 0",
      ].join("\n")
    )

    await emitLog(input, {
      kind: "command",
      message: compactLine(codexCommand),
    })
    let codexThreadId = codexThreadIdToResume
    const stdoutLogger = createStdoutLogger(input.onLog, (threadId) => {
      codexThreadId = threadId
    })
    const result = redactAuthPathOutput(
      await sandbox.commands.run(`bash -lc ${command}`, {
        envs: {
          CODEX_HOME,
          HOME: "/home/user",
        },
        onStderr: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) {
            void input.onLog?.({ kind: "stderr", message: trimmed })
          }
        },
        onStdout: (data) => stdoutLogger.chunk(data),
        timeoutMs,
      })
    )
    stdoutLogger.flush()

    await emitLog(input, { kind: "command", message: "git diff --binary HEAD" })
    const diff = (
      await sandbox.commands.run(
        `git -C ${REPO_PATH} add -N . >/dev/null 2>&1 || true; git -C ${REPO_PATH} diff --binary HEAD`,
        {
          timeoutMs: 60_000,
        }
      )
    ).stdout
    await emitLog(input, {
      kind: "command",
      message: "git status --short --branch",
    })
    const status = (
      await sandbox.commands.run(
        `git -C ${REPO_PATH} status --short --branch`,
        {
          timeoutMs: 60_000,
        }
      )
    ).stdout
    await emitLog(input, {
      kind: "result",
      message:
        result.exitCode === 0
          ? "Codex run completed"
          : `Codex exited with code ${result.exitCode}`,
    })

    return {
      branchName,
      codexThreadId,
      diff,
      exitCode: result.exitCode,
      lastMessage: await readLastMessage(sandbox),
      repoUrl,
      sandboxId: sandbox.sandboxId,
      stderr: result.stderr,
      status,
      stdout: result.stdout,
      updatedAuthJson: await sandbox.files.read(`${CODEX_HOME}/auth.json`),
      recoveredSandbox,
    } satisfies RunCodexInSandboxResult
  } finally {
    await sandbox.commands
      .run(
        `rm -f ${CODEX_HOME}/auth.json ${PROMPT_PATH} ${PREVIOUS_DIFF_PATH} ${LAST_MESSAGE_PATH}`,
        {
          timeoutMs: 10_000,
        }
      )
      .catch(() => undefined)
  }
}
