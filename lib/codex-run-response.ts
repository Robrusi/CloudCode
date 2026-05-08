export type CodexRunLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

export type CodexRunLog = {
  detail?: string
  kind: CodexRunLogKind
  message: string
}

export type CodexRunResult = {
  branchName?: unknown
  codexThreadId?: unknown
  diff?: unknown
  error?: unknown
  lastMessage?: unknown
  sandboxId?: unknown
  status?: unknown
  stderr?: unknown
  stdout?: unknown
}

type CodexRunStreamEvent =
  | {
      log?: CodexRunLog
      time?: number
      type: "progress"
    }
  | {
      result?: CodexRunResult
      type: "done"
    }
  | {
      error?: string
      type: "error"
    }

async function readJsonError(res: Response) {
  try {
    const data = (await res.json()) as CodexRunResult
    return (
      (typeof data.lastMessage === "string" && data.lastMessage.trim()) ||
      (typeof data.stderr === "string" && data.stderr.trim()) ||
      (typeof data.stdout === "string" && data.stdout.trim()) ||
      (typeof data.error === "string" && data.error.trim()) ||
      `Request failed (${res.status})`
    )
  } catch {
    return `Request failed (${res.status})`
  }
}

export async function readCodexRunResponse(
  res: Response,
  onLog: (log: CodexRunLog, time?: number) => void
) {
  const contentType = res.headers.get("content-type") ?? ""

  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }

  if (!contentType.includes("application/x-ndjson") || !res.body) {
    return (await res.json()) as CodexRunResult
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: CodexRunResult | null = null

  function consume(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    const event = JSON.parse(trimmed) as CodexRunStreamEvent
    if (event.type === "progress" && event.log) {
      onLog(event.log, event.time)
    } else if (event.type === "done") {
      result = event.result ?? {}
    } else if (event.type === "error") {
      throw new Error(event.error ?? "Codex sandbox run failed.")
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) consume(line)
  }

  buffer += decoder.decode()
  if (buffer) consume(buffer)
  if (!result) throw new Error("Codex run ended without a result.")

  return result
}
