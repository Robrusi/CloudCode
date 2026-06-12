import type { CodexAppServerClientOptions } from "@/lib/codex/app-server"
import { objectRecord, rawStringValue } from "@/lib/shared/unknown-values"

const TOOL_APPROVAL_DECLINED = { decision: "decline" }
const EXEC_APPROVAL_DENIED = { decision: "denied" }

export async function codexAppServerRequestResult(
  method: string,
  params: unknown,
  options: CodexAppServerClientOptions
): Promise<unknown> {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return TOOL_APPROVAL_DECLINED
    case "item/fileChange/requestApproval":
      return TOOL_APPROVAL_DECLINED
    case "execCommandApproval":
    case "applyPatchApproval":
      return EXEC_APPROVAL_DENIED
    case "mcpServer/elicitation/request":
      return { _meta: null, action: "decline", content: null }
    case "item/tool/requestUserInput":
      return { answers: emptyToolInputAnswers(params) }
    case "item/permissions/requestApproval":
      return { permissions: {}, scope: "turn", strictAutoReview: true }
    case "item/tool/call":
      return {
        contentItems: [
          {
            text: unsupportedDynamicToolMessage(params),
            type: "inputText",
          },
        ],
        success: false,
      }
    case "account/chatgptAuthTokens/refresh":
      return await options.refreshChatgptAuthTokens?.(params)
    case "attestation/generate":
      return { token: (await options.generateAttestationToken?.()) ?? "" }
    default:
      return undefined
  }
}

function emptyToolInputAnswers(params: unknown) {
  const record = objectRecord(params)
  const questions = Array.isArray(record?.questions) ? record.questions : []

  return Object.fromEntries(
    questions.flatMap((question) => {
      const questionRecord = objectRecord(question)
      const id = rawStringValue(questionRecord?.id)
      return id ? [[id, { answers: [] }]] : []
    })
  )
}

function unsupportedDynamicToolMessage(params: unknown) {
  const record = objectRecord(params)
  const name = [record?.namespace, record?.tool]
    .filter(
      (value): value is string => typeof value === "string" && Boolean(value)
    )
    .join(".")

  return name
    ? `Cloudcode cannot execute app-server dynamic tool request ${name} in this worker.`
    : "Cloudcode cannot execute this app-server dynamic tool request in this worker."
}
