import { NextResponse } from "next/server"

import { listCurrentGitHubAppRepositories } from "@/lib/github-app"

export const runtime = "nodejs"

export async function GET() {
  try {
    const repositories = await listCurrentGitHubAppRepositories()
    return NextResponse.json({ repositories })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to list GitHub repositories.",
      },
      { status: 401 }
    )
  }
}
