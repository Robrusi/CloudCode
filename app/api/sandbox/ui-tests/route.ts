import { NextResponse } from "next/server"

import {
  BillingRequiredError,
  getStartedCurrentUserDaytonaSandbox,
  pauseCurrentUserSandboxForBilling,
} from "@/lib/billing/server"
import { getDaytonaSandbox } from "@/lib/daytona/sandbox"
import {
  getDaytonaUiTestRun,
  listDaytonaUiTestRuns,
  listDaytonaUiTests,
  runDaytonaUiTest,
} from "@/lib/daytona/ui-tests"
import {
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  requireCurrentUserSandbox,
  SandboxAuthorizationError,
} from "@/lib/sandbox/authorization"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const sandboxId = searchStringParam(request, "sandboxId")
  const runId = searchStringParam(request, "runId")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const sandbox = await getDaytonaSandbox(sandboxId)
    await sandbox.refreshData().catch(() => undefined)
    const running = sandbox.state === "started"

    if (runId) {
      if (!running) {
        return jsonError("Sandbox is not running.", 409)
      }
      return NextResponse.json(
        await getDaytonaUiTestRun(sandbox, runId, { signal: request.signal })
      )
    }

    if (!running) {
      return NextResponse.json({
        running: false,
        runs: [],
        testDir: null,
        tests: [],
      })
    }

    const tests = await listDaytonaUiTests(sandbox, { signal: request.signal })
    const runs = await listDaytonaUiTestRuns(sandbox, {
      signal: request.signal,
    })
    return NextResponse.json({
      running: true,
      runs: runs.runs,
      testDir: tests.testDir,
      tests: tests.tests,
    })
  } catch (error) {
    if (error instanceof SandboxAuthorizationError) {
      return jsonError(error.message, 404)
    }
    return jsonError(
      error instanceof Error ? error.message : "Failed to read UI tests.",
      500
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")
  const action = jsonStringField(body, "action")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (action !== "run") {
    return jsonError("invalid ui-tests action", 400)
  }

  try {
    const { sandbox } = await getStartedCurrentUserDaytonaSandbox(sandboxId)
    // Intentionally not forwarding request.signal: the run must finish and
    // persist its result.json even if the client disconnects, so the tests tab
    // can recover the outcome by polling the runs list.
    const result = await runDaytonaUiTest(sandbox, {
      baseUrl: jsonStringField(body, "baseUrl"),
      grep: jsonStringField(body, "grep"),
      testPath: jsonStringField(body, "testPath"),
      timeoutMs: jsonNumberField(body, "timeoutMs"),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SandboxAuthorizationError) {
      return jsonError(error.message, 404)
    }
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
      return jsonError(error.message, 402)
    }
    return jsonError(
      error instanceof Error ? error.message : "Failed to run UI tests.",
      500
    )
  }
}
