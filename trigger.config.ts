import { defineConfig, timeout } from "@trigger.dev/sdk"
import { loadEnvConfig } from "@next/env"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

loadEnvConfig(process.cwd())
mkdirSync(join(process.cwd(), ".trigger", "tmp", "store"), { recursive: true })

// The project ref is a non-secret identifier and must resolve during the
// managed deploy/index step, which runs in an isolated build container with no
// access to local .env files (process.cwd() is not the project root there).
// Keep the env override for flexibility, but fall back to the literal so deploy
// never aborts on a missing env var.
const project = process.env.TRIGGER_PROJECT_REF ?? "proj_getetvnaifsfxtvhnkdk"

export default defineConfig({
  project,
  dirs: ["./trigger"],
  maxDuration: timeout.None,
  build: {
    // Daytona resolves form-data with createRequire at upload time. Keep it as
    // an installed worker dependency so that lookup succeeds from bundled code.
    external: ["form-data"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
})
