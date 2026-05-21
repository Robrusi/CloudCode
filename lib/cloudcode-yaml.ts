import { createHash } from "node:crypto"

import YAML from "yaml"

export type CloudcodeCommand = {
  name?: string
  run: string
  timeoutMinutes?: number
}

export type CloudcodeYamlConfig = {
  agent?: {
    commands?: Record<string, string>
  }
  checks: CloudcodeCommand[]
  dev?: {
    command: string
    port?: number
  }
  global: {
    install: CloudcodeCommand[]
  }
  repo: {
    install: CloudcodeCommand[]
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asTimeoutMinutes(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value), 120)
    : undefined
}

function normalizeCommand(value: unknown): CloudcodeCommand | null {
  if (typeof value === "string" && value.trim()) {
    return { run: value.trim() }
  }

  const record = asRecord(value)
  const run = asString(record.run) ?? asString(record.contents)
  if (!run) return null

  if (run.length > 20_000) {
    throw new Error("cloudcode.yaml contains a command that is too long.")
  }

  return {
    ...(asString(record.name) ? { name: asString(record.name) } : {}),
    run,
    ...(asTimeoutMinutes(record.timeoutMinutes)
      ? { timeoutMinutes: asTimeoutMinutes(record.timeoutMinutes) }
      : {}),
  }
}

function normalizeCommands(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeCommand)
    .filter((command): command is CloudcodeCommand => command !== null)
    .slice(0, 80)
}

function normalizeAgentCommands(value: unknown) {
  const record = asRecord(value)
  return Object.fromEntries(
    Object.entries(record).flatMap(([name, command]) => {
      const cleanName = asString(name)
      const cleanCommand = asString(command)
      return cleanName && cleanCommand ? [[cleanName, cleanCommand]] : []
    })
  )
}

function normalizeDev(value: unknown) {
  const record = asRecord(value)
  const command = asString(record.command) ?? asString(record.run)
  if (!command) return undefined

  return {
    command,
    ...(typeof record.port === "number" && Number.isFinite(record.port)
      ? { port: Math.round(record.port) }
      : {}),
  }
}

export function parseCloudcodeYaml(source: string): CloudcodeYamlConfig {
  const parsed = YAML.parse(source) as unknown
  const root = asRecord(parsed)
  const globalConfig = asRecord(root.global)
  const repoConfig = asRecord(root.repo)
  const agentConfig = asRecord(root.agent)
  const legacyKnowledge = normalizeCommands(root.knowledge)
  const agentCommands = normalizeAgentCommands(agentConfig.commands)

  for (const command of legacyKnowledge) {
    if (command.name) agentCommands[command.name] = command.run
  }

  const config = {
    agent: Object.keys(agentCommands).length
      ? { commands: agentCommands }
      : undefined,
    checks: [
      ...normalizeCommands(root.checks),
      ...legacyKnowledge.filter((command) => !command.name),
    ],
    dev: normalizeDev(root.dev),
    global: {
      install: [
        ...normalizeCommands(root.global),
        ...normalizeCommands(globalConfig.install),
        ...normalizeCommands(root.initialize),
      ],
    },
    repo: {
      install: [
        ...normalizeCommands(root.repo),
        ...normalizeCommands(repoConfig.install),
        ...normalizeCommands(root.maintenance),
      ],
    },
  } satisfies CloudcodeYamlConfig

  if (
    config.global.install.length === 0 &&
    config.repo.install.length === 0 &&
    config.checks.length === 0
  ) {
    throw new Error(
      "cloudcode.yaml must define at least one global install, repo install, or check command."
    )
  }

  return config
}

export function formatCloudcodeYaml(config: CloudcodeYamlConfig) {
  return YAML.stringify(
    {
      global: config.global.install.length ? config.global.install : undefined,
      repo: config.repo.install.length ? config.repo.install : undefined,
      checks: config.checks.length ? config.checks : undefined,
      dev: config.dev,
      agent: config.agent,
    },
    {
      lineWidth: 0,
    }
  )
}

export function normalizeCloudcodeYaml(source: string) {
  return formatCloudcodeYaml(parseCloudcodeYaml(source))
}

export function cloudcodeYamlHash(source: string, extra = "") {
  return createHash("sha256")
    .update(normalizeCloudcodeYaml(source))
    .update("\0")
    .update(extra)
    .digest("hex")
}

export function cloudcodeYamlAgentContext(source?: string) {
  if (!source?.trim()) return ""

  const config = parseCloudcodeYaml(source)
  const commands = [
    ...config.checks.map((command) => {
      const label = command.name ? `${command.name}: ` : ""
      return `${label}${command.run}`
    }),
    ...Object.entries(config.agent?.commands ?? {}).map(
      ([name, command]) => `${name}: ${command}`
    ),
    ...(config.dev ? [`dev: ${config.dev.command}`] : []),
  ]

  if (commands.length === 0) return ""

  return [
    "Repository environment commands from cloudcode.yaml:",
    ...commands.map((command) => `- ${command}`),
  ].join("\n")
}
