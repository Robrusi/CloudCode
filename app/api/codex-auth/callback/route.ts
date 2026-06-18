import { codexAuthDisabledResponse } from "@/lib/codex/auth-disabled-response"

export const runtime = "nodejs"

export async function GET() {
  return codexAuthDisabledResponse({ clearOAuthState: true })
}
