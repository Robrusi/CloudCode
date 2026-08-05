import assert from "node:assert/strict"

import type { RunCodexInSandboxInput } from "@/lib/daytona/codex-agent-types"
import { codexWarmStartFingerprint } from "@/lib/daytona/codex-warm-start"
import {
  CLOUDCODE_ENV_START,
  writeCloudcodeEnvLocal,
  type SandboxEnvTarget,
} from "@/lib/sandbox/env"

const paths = {
  baseRefPath: "/tmp/base-ref",
  cloudcodeProfilePath: "/home/daytona/.cloudcode-profile",
  codexHome: "/home/daytona/.cloudcode-home/.codex",
  codexLauncherPath: "/tmp/codex",
  home: "/home/daytona",
  lastMessagePath: "/tmp/last-message",
  presetEnvPath: "/home/daytona/.cloudcode-home/.codex/preset-env.sh",
  previousDiffPath: "/tmp/previous-diff",
  promptPath: "/tmp/prompt",
  repoPath: "/home/daytona/repo",
  runtimeHome: "/home/daytona/.cloudcode-home",
}
const versions = {
  cli: "1.2.3",
  contextTool: "context-1",
  daemon: "daemon-1",
  desktopTool: "desktop-1",
  factoryTool: "factory-1",
  githubTool: "github-1",
  skills: "skills-1",
}
const input: RunCodexInSandboxInput = {
  authJson: '{"tokens":{"access_token":"first"}}',
  codexThreadId: "codex-thread-1",
  prompt: "first prompt",
  repoUrl: "https://github.com/example/repo.git",
  runId: "run-1",
  sandboxId: "sandbox-1",
  sandboxPreset: {
    name: "Node",
    secrets: [{ name: "API_KEY", value: "secret" }],
  },
  threadId: "thread-1",
}
const fingerprint = (overrides: Partial<RunCodexInSandboxInput> = {}) =>
  codexWarmStartFingerprint({
    contextConfig: "context config",
    desktopInstructions: "desktop instructions",
    input: { ...input, ...overrides },
    mcpConfig: "mcp config",
    paths,
    repoUrl: input.repoUrl,
    useBaseBranch: false,
    versions,
  })

const initialFingerprint = fingerprint()
assert.equal(
  fingerprint({
    authJson: '{"tokens":{"access_token":"refreshed"}}',
    codexThreadId: "codex-thread-2",
    prompt: "a later prompt",
    runId: "run-2",
  }),
  initialFingerprint,
  "per-turn state must not invalidate a prepared sandbox"
)
assert.notEqual(
  fingerprint({
    sandboxPreset: {
      ...input.sandboxPreset!,
      secrets: [{ name: "API_KEY", value: "changed" }],
    },
  }),
  initialFingerprint,
  "preset changes must invalidate a prepared sandbox"
)
assert.notEqual(
  fingerprint({ threadId: "thread-2" }),
  initialFingerprint,
  "a sandbox must not be reused across Cloudcode threads"
)

const files = new Map<string, string>()
const envPath = `${paths.repoPath}/.env.local`
const target: SandboxEnvTarget = {
  readTextFile: async (path) => {
    const value = files.get(path)
    if (value === undefined) throw new Error("not found")
    return value
  },
  runCommand: async () => {
    files.delete(envPath)
    return { exitCode: 0, stderr: "", stdout: "" }
  },
  writeTextFile: async (path, content) => {
    files.set(path, content)
  },
}

assert.deepEqual(
  await writeCloudcodeEnvLocal(target, paths.repoPath, [
    { name: "API_KEY", value: "secret" },
  ]),
  { changed: true }
)
assert.ok(files.get(envPath)?.includes(CLOUDCODE_ENV_START))
assert.deepEqual(
  await writeCloudcodeEnvLocal(target, paths.repoPath, [
    { name: "API_KEY", value: "secret" },
  ]),
  { changed: false },
  "unchanged preset secrets must not rewrite .env.local"
)
assert.deepEqual(
  await writeCloudcodeEnvLocal(target, paths.repoPath, [
    { name: "API_KEY", value: "changed" },
  ]),
  { changed: true }
)

console.log("sandbox warm-start tests passed")
