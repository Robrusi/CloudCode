import { NextResponse } from "next/server"

import {
  BillingRequiredError,
  getStartedCurrentUserDaytonaSandbox,
} from "@/lib/billing/server"
import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  getDaytonaTerminalUrl,
  resolveDaytonaPaths,
} from "@/lib/daytona/sandbox"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"
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
    const sandboxAccess = await requireCurrentUserSandbox(sandboxId)
    const githubAuth = await maybeGetCurrentGitHubRepoCredential(
      sandboxAccess.repoUrl
    )

    let sandbox:
      | Awaited<
          ReturnType<typeof getStartedCurrentUserDaytonaSandbox>
        >["sandbox"]
      | undefined
    if (githubAuth?.token) {
      sandbox = (await getStartedCurrentUserDaytonaSandbox(sandboxId)).sandbox
      const paths = await resolveDaytonaPaths(sandbox)
      const auth = await setupSandboxGitHubAuth({
        githubToken: githubAuth.token,
        githubUserEmail: githubAuth.gitUserEmail,
        githubUserName: githubAuth.gitUserName,
        githubUsername: githubAuth.username,
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

    if (!sandbox) {
      await getStartedCurrentUserDaytonaSandbox(sandboxId)
    }

    return NextResponse.json({
      url: await getDaytonaTerminalUrl(sandboxId),
    })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      return jsonError(error.message, 402)
    }

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to open Daytona terminal",
      500
    )
  }
}
