import { NextResponse } from "next/server"

import {
  getDaytonaTerminalUrl,
  getStartedDaytonaSandbox,
  resolveDaytonaPaths,
} from "@/lib/daytona-sandbox"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
} from "@/lib/sandbox-github-auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandboxAccess = await requireCurrentUserSandbox(sandboxId)
    const githubAuth = await maybeGetCurrentGitHubRepoCredential(
      sandboxAccess.repoUrl
    )

    if (githubAuth?.token) {
      const sandbox = await getStartedDaytonaSandbox(sandboxId)
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

    return NextResponse.json({
      url: await getDaytonaTerminalUrl(sandboxId),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to open Daytona terminal",
      },
      { status: 500 }
    )
  }
}
