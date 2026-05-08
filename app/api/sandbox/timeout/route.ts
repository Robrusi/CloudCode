import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Manual sandbox timeout updates were removed. Daytona auto-stop handles lifecycle.",
    },
    { status: 410 }
  )
}
