import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    { error: "Manual sandbox pause was removed. Daytona owns sandbox lifecycle." },
    { status: 410 }
  )
}
