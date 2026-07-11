import { NextResponse } from "next/server"

import {
  BillingRequiredError,
  getRunningCurrentUserDaytonaSandbox,
  SandboxNotRunningError,
} from "@/lib/billing/server"
import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  DaytonaSandboxNotRunningError,
  getDaytonaTerminalUrl,
  resolveDaytonaPaths,
} from "@/lib/daytona/sandbox"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
} from "@/lib/sandbox/github-auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const sandboxId = searchStringParam(request, "sandboxId")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    const { access: sandboxAccess, sandbox } =
      await getRunningCurrentUserDaytonaSandbox(sandboxId)
    const githubAuth = await maybeGetCurrentGitHubRepoCredential(
      sandboxAccess.repoUrl
    )

    if (githubAuth?.token) {
      const paths = await resolveDaytonaPaths(sandbox)
      const auth = await setupSandboxGitHubAuth({
        githubToken: githubAuth.token,
        githubUserEmail: githubAuth.gitUserEmail,
        githubUserName: githubAuth.gitUserName,
        installGlobal: true,
        paths,
        repoUrl: sandboxAccess.repoUrl,
        sandbox,
      })
      await configureSandboxGitHubRemote({
        auth,
        paths,
        sandbox,
      })
    }

    return NextResponse.json({
      url: await getDaytonaTerminalUrl(sandboxId, { sandbox }),
    })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      return jsonError(error.message, 402)
    }
    if (
      error instanceof SandboxNotRunningError ||
      error instanceof DaytonaSandboxNotRunningError
    ) {
      return jsonError(error.message, 409, { sandboxNotRunning: true })
    }

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to open Daytona terminal",
      500
    )
  }
}
