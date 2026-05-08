import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Manual sandbox snapshots were removed. Use Daytona snapshots as presets.",
    },
    { status: 410 }
  )
}

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        "Manual sandbox snapshot deletion was removed. Delete preset snapshots in Daytona.",
    },
    { status: 410 }
  )
}
