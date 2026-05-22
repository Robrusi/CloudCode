import { defineConfig, timeout } from "@trigger.dev/sdk"
import { loadEnvConfig } from "@next/env"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

loadEnvConfig(process.cwd())
mkdirSync(join(process.cwd(), ".trigger", "tmp", "store"), { recursive: true })

const project = process.env.TRIGGER_PROJECT_REF

if (!project) {
  throw new Error("Set TRIGGER_PROJECT_REF to your Trigger.dev project ref.")
}

export default defineConfig({
  project,
  dirs: ["./trigger"],
  maxDuration: timeout.None,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
})
