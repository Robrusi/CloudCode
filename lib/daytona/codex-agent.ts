import type { Sandbox } from "@daytona/sdk"

import { runCodexViaAppServer } from "@/lib/daytona/codex-app-server-run"

import { defaultBranchName, parseBranchMode } from "@/lib/codex/branch-names"
import {
  isCodexLauncherReady,
  updateCodexCli,
} from "@/lib/daytona/codex-cli-setup"
import {
  daytonaDesktopAgentContext,
  installDaytonaDesktopTools,
  stopDaytonaDesktopAgentRecording,
  type DaytonaDesktopRecordingArtifact,
} from "@/lib/daytona/desktop"
import {
  cloudcodeContextAgentContext,
  cloudcodeContextAgentInstructions,
  cloudcodeContextCodexConfig,
  installCloudcodeContextTools,
} from "@/lib/daytona/context"
import { buildImageAttachmentPromptBlock } from "@/lib/chat/attachments"
import { compactLine } from "@/lib/shared/compact-line"
import {
  createDaytonaSandbox,
  defaultDaytonaSnapshot,
  defaultDaytonaSandboxResources,
  ensureDaytonaSandboxStarted,
  getDaytonaSandbox,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  startDaytonaActivityHeartbeat,
  writeDaytonaTextFile,
} from "@/lib/daytona/sandbox"
import {
  cleanupRunFiles,
  collectRunDiffAndStatus,
  emitRunLog as emitLog,
  prepareSandboxRuntime,
  runLiveCloudcodeYamlSetup,
} from "@/lib/daytona/codex-runtime-setup"
import {
  cloneRepo,
  prepareExistingRepoForFreshRun,
  readRepoState,
  trustRepoMiseConfig,
  writeBaseRef,
} from "@/lib/daytona/codex-repo"
import { materializeSandboxImageAttachments } from "@/lib/daytona/image-attachments"
import {
  parseCodexReasoningEffortOrThrow,
  parseCodexSpeedOrThrow,
} from "@/lib/codex/run-options"
import type {
  CodexRunLog as RunCodexLog,
  CodexRunLogKind as RunCodexLogKind,
} from "@/lib/codex/run-log"
import {
  parseCodexModel,
  parseGitRef,
  parseOpaqueId,
  parseRequiredGitRepoUrl,
} from "@/lib/codex/run-input"
import { cloudcodeYamlAgentContext } from "@/lib/cloudcode/yaml"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox/github-auth"
import {
  presetSecretEnv,
  userMcpCodexConfig,
} from "@/lib/daytona/codex-runtime"
import {
  runPathInstallScript,
  runPresetInstallScript,
} from "@/lib/daytona/codex-install-scripts"
import type {
  RunCodexInSandboxInput,
  RunCodexInSandboxResult,
} from "@/lib/daytona/codex-agent-types"

export type { RunCodexLog, RunCodexLogKind }

function sandboxIsUnderResourced(sandbox: Sandbox) {
  const desired = defaultDaytonaSandboxResources()
  return (
    sandbox.cpu < desired.cpu ||
    sandbox.memory < desired.memory ||
    sandbox.disk < desired.disk
  )
}

async function connectOrCreateSandbox(input: RunCodexInSandboxInput) {
  const createNewSandbox = () =>
    createDaytonaSandbox({
      envVars: presetSecretEnv(input.sandboxPreset?.secrets),
      labels: {
        "cloudcode-run-id": input.runId,
        "cloudcode-thread-id": input.threadId,
        "cloudcode-user-id": input.userId,
      },
      name: input.sandboxPreset?.name,
      snapshot: input.sandboxPreset?.daytonaSnapshot,
    })
  const desiredSnapshot =
    input.sandboxPreset?.daytonaSnapshot?.trim() || defaultDaytonaSnapshot()

  if (input.sandboxId) {
    try {
      const sandbox = await ensureDaytonaSandboxStarted(
        await getDaytonaSandbox(input.sandboxId)
      )
      const snapshotMismatch =
        desiredSnapshot && sandbox.snapshot !== desiredSnapshot
      const resourceMismatch =
        !desiredSnapshot && sandboxIsUnderResourced(sandbox)
      if (snapshotMismatch || resourceMismatch) {
        await sandbox
          .delete(120)
          .catch(() => sandbox.stop(120, true).catch(() => undefined))
        return {
          createdSandbox: true,
          recoveredSandbox: true,
          sandbox: await createNewSandbox(),
        }
      }

      return {
        createdSandbox: false,
        recoveredSandbox: false,
        sandbox,
      }
    } catch {
      // The DB can outlive an auto-deleted sandbox. Continue in a fresh one.
    }
  }

  return {
    createdSandbox: true,
    recoveredSandbox: Boolean(input.sandboxId),
    sandbox: await createNewSandbox(),
  }
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseCodexModel(input.model)
  const reasoningEffort = parseCodexReasoningEffortOrThrow(
    input.reasoningEffort
  )
  const repoUrl = parseRequiredGitRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const useBaseBranch = parseBranchMode(input.branchMode) === "base"
  const requestedBranchName = useBaseBranch
    ? undefined
    : parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim()
  const speed = parseCodexSpeedOrThrow(input.speed)
  const existingCodexThreadId = parseOpaqueId(
    input.codexThreadId,
    "codexThreadId"
  )

  const [, sandboxConnection] = await Promise.all([
    emitLog(input, {
      kind: "setup",
      message: input.sandboxId
        ? "Connecting to Daytona sandbox"
        : input.sandboxPreset?.daytonaSnapshot
          ? "Creating Daytona sandbox from preset snapshot"
          : "Creating Daytona sandbox",
    }),
    connectOrCreateSandbox(input),
  ])
  const { createdSandbox, recoveredSandbox, sandbox } = sandboxConnection
  await emitLog(input, {
    detail: sandbox.id,
    kind: "setup",
    message: recoveredSandbox
      ? "Recovered with a fresh Daytona sandbox"
      : "Daytona sandbox ready",
  })
  const paths = await resolveDaytonaPaths(sandbox)
  let gitAuth: SandboxGitHubAuth | null = null
  let stopDaytonaActivityHeartbeat: (() => void) | undefined
  let checkedDesktopAgentRecording = false
  let emittedDesktopRecordingStopError = false
  let desktopRecording: DaytonaDesktopRecordingArtifact | undefined

  async function stopDesktopAgentRecording() {
    if (checkedDesktopAgentRecording) return

    try {
      const recording = await stopDaytonaDesktopAgentRecording(
        sandbox,
        paths,
        input.signal
      )
      checkedDesktopAgentRecording = true
      if (!recording) return
      desktopRecording = recording

      await emitLog(input, {
        kind: "setup",
        message: "Daytona desktop recording ready",
      })
    } catch (error) {
      if (emittedDesktopRecordingStopError) return
      emittedDesktopRecordingStopError = true
      await emitLog(input, {
        kind: "stderr",
        message:
          error instanceof Error
            ? compactLine(error.message)
            : "Unable to stop Daytona desktop recording.",
      })
    }
  }

  try {
    stopDaytonaActivityHeartbeat = startDaytonaActivityHeartbeat(sandbox)
    gitAuth = await setupSandboxGitHubAuth({
      githubToken,
      githubUserEmail: input.githubUserEmail,
      githubUserName: input.githubUserName,
      githubUsername: input.githubUsername,
      persistCredentials: true,
      paths,
      repoUrl,
      sandbox,
      signal: input.signal,
    })
    const repoStatePromise = readRepoState(sandbox, paths)

    await emitLog(input, {
      detail: sandbox.snapshot,
      kind: "setup",
      message: `Sandbox resources: ${sandbox.cpu} CPU, ${sandbox.memory} GB RAM`,
    })

    const codexThreadIdToResume = existingCodexThreadId
    const sandboxImageAttachments = await materializeSandboxImageAttachments({
      attachments: input.imageAttachments ?? [],
      onAttachmentReady: (attachment) =>
        emitLog(input, {
          detail: attachment.sandboxPath,
          kind: "setup",
          message: "Image attachment ready",
        }),
      paths,
      runId: input.runId,
      sandbox,
      signal: input.signal,
    })
    const taskPrompt = input.prompt
    const sharedNotesEnabled = Boolean(
      input.convexUrl && input.notesAccessToken && input.runId && input.threadId
    )
    const contextBlocks = [
      cloudcodeYamlAgentContext(input.sandboxPreset?.cloudcodeYaml),
      sharedNotesEnabled ? cloudcodeContextAgentContext() : undefined,
      daytonaDesktopAgentContext(),
      buildImageAttachmentPromptBlock(sandboxImageAttachments),
    ].filter((value): value is string => Boolean(value))
    const promptForTask = (task: string) =>
      contextBlocks.length
        ? [...contextBlocks, "Current user request:", task].join("\n\n")
        : task
    const prompt = promptForTask(taskPrompt)
    const contextConfig = cloudcodeContextCodexConfig({
      convexUrl: input.convexUrl,
      notesAccessToken: input.notesAccessToken,
      paths,
      runId: input.runId,
      threadId: input.threadId,
    })
    const mcpConfig = [contextConfig, userMcpCodexConfig(input.mcpServers)]
      .filter(Boolean)
      .join("\n")
    const needsCodexSetup =
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox, paths, input.signal))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input, paths)
    }

    const repoState = await repoStatePromise
    const repoAlreadyExists = repoState.exists
    const configureGitHubRemoteIfNeeded = async () => {
      if (gitAuth?.remoteUrl && repoState.remoteUrl === gitAuth.remoteUrl) {
        return
      }
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
    }
    let preparedFreshRepo = false
    if (!repoAlreadyExists) {
      branchName = await cloneRepo({
        baseBranch,
        branchName,
        gitAuth,
        githubToken,
        input,
        requestedBranchName,
        repoUrl,
        sandbox,
        paths,
        useBaseBranch,
      })
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
      await trustRepoMiseConfig(sandbox, input, paths)
      await writeBaseRef(sandbox, paths)
      preparedFreshRepo = true
    } else {
      await configureGitHubRemoteIfNeeded()
      await trustRepoMiseConfig(sandbox, input, paths)
      const shouldPrepareFreshRepo = createdSandbox
      if (shouldPrepareFreshRepo) {
        branchName = await prepareExistingRepoForFreshRun({
          baseBranch,
          branchName,
          gitAuth,
          input,
          paths,
          requestedBranchName,
          sandbox,
          useBaseBranch,
        })
        await writeBaseRef(sandbox, paths)
        preparedFreshRepo = true
      }
    }
    if (repoAlreadyExists && !preparedFreshRepo) {
      // No branch was created this run, so report the branch HEAD is actually on
      // rather than the generated fallback. Matters most for "base" mode, where
      // the work stays on the base branch across continuations.
      if (repoState.branch) branchName = repoState.branch
    }
    if (preparedFreshRepo && input.previousDiff?.trim()) {
      await Promise.all([
        emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        }),
        writeDaytonaTextFile(
          sandbox,
          paths.previousDiffPath,
          input.previousDiff
        ),
      ])
      const applyResult = await runDaytonaCommand(
        sandbox,
        `git -C ${shellQuote(
          paths.repoPath
        )} apply --whitespace=nowarn ${shellQuote(paths.previousDiffPath)}`,
        { signal: input.signal, timeoutMs: 60_000 }
      )
      if (applyResult.exitCode !== 0) {
        await emitLog(input, {
          kind: "stderr",
          message:
            compactLine(applyResult.stderr || applyResult.stdout) ||
            "Unable to apply previous diff.",
        })
      }
    }

    await prepareSandboxRuntime(sandbox, input, paths)
      .then(() => runLiveCloudcodeYamlSetup(sandbox, input, paths, gitAuth))
      .then(() =>
        contextConfig
          ? installCloudcodeContextTools(sandbox, paths, input.signal)
          : undefined
      )
      .then(() =>
        installDaytonaDesktopTools(sandbox, paths, input.signal, {
          config: mcpConfig,
          instructions: contextConfig
            ? cloudcodeContextAgentInstructions()
            : undefined,
        })
      )
      .then(() => runPathInstallScript(sandbox, input, paths, gitAuth))
      .then(() => runPresetInstallScript(sandbox, input, paths, gitAuth))

    {
      const appServerResult = await runCodexViaAppServer({
        codexThreadIdToResume,
        gitAuth,
        input,
        model,
        paths,
        prompt,
        reasoningEffort,
        sandbox,
        speed,
      })
      await stopDesktopAgentRecording()

      await Promise.all([
        appServerResult.exitCode === 0
          ? Promise.resolve()
          : emitLog(input, {
              detail: String(appServerResult.exitCode),
              kind: "stderr",
              message: `Codex exited with code ${appServerResult.exitCode}`,
            }),
        cleanupRunFiles(sandbox, paths, input.signal),
      ])
      const { updatedAuthJson } = appServerResult

      const { diff, status } = await collectRunDiffAndStatus({
        exitCode: appServerResult.exitCode,
        gitAuth,
        input,
        paths,
        sandbox,
      })

      return {
        branchName,
        codexThreadId: appServerResult.codexThreadId,
        desktopRecording,
        diff,
        exitCode: appServerResult.exitCode,
        lastMessage: appServerResult.lastMessage,
        lastMessageAuthoritative: true,
        repoUrl,
        sandboxId: sandbox.id,
        stderr: appServerResult.stderr,
        status,
        stdout: appServerResult.stdout,
        updatedAuthJson,
        recoveredSandbox,
      } satisfies RunCodexInSandboxResult
    }
  } finally {
    stopDaytonaActivityHeartbeat?.()
    await stopDesktopAgentRecording()
    await Promise.all([
      cleanupRunFiles(sandbox, paths, input.signal),
      gitAuth?.cleanup() ?? Promise.resolve(),
    ])
  }
}
