import nextEnv from "@next/env"
import { envvars } from "@trigger.dev/sdk"

const { loadEnvConfig } = nextEnv

loadEnvConfig(process.cwd())

const projectRef = process.env.TRIGGER_PROJECT_REF?.trim()
const environment = process.env.TRIGGER_DEPLOY_ENV?.trim() || "prod"

const githubEnvironmentNames = [
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_SLUG",
]
const workerEnvironmentNames = [
  ...githubEnvironmentNames,
  "TRIGGER_WORKER_SECRET",
]

if (!projectRef) {
  throw new Error("TRIGGER_PROJECT_REF is required to sync Trigger env vars.")
}
if (!process.env.TRIGGER_SECRET_KEY?.trim()) {
  throw new Error("TRIGGER_SECRET_KEY is required to sync Trigger env vars.")
}

const missing = workerEnvironmentNames.filter(
  (name) => !process.env[name]?.trim()
)
if (missing.length > 0) {
  throw new Error(
    `Missing required Trigger worker env vars: ${missing.join(", ")}`
  )
}

const variables = Object.fromEntries(
  githubEnvironmentNames.map((name) => [name, process.env[name].trim()])
)

await envvars.upload(projectRef, environment, {
  override: true,
  variables,
})

// Trigger's bulk import silently excludes reserved TRIGGER_* variables. Keep
// the worker credential aligned with Convex through the single-variable API.
const workerSecretUrl = new URL(
  `/api/v1/projects/${encodeURIComponent(projectRef)}/envvars/${encodeURIComponent(environment)}/TRIGGER_WORKER_SECRET`,
  process.env.TRIGGER_API_URL?.trim() || "https://api.trigger.dev"
)
const workerSecretResponse = await fetch(workerSecretUrl, {
  body: JSON.stringify({ value: process.env.TRIGGER_WORKER_SECRET.trim() }),
  headers: {
    authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
    "content-type": "application/json",
  },
  method: "PUT",
})
if (!workerSecretResponse.ok) {
  throw new Error(
    `Unable to sync TRIGGER_WORKER_SECRET (${workerSecretResponse.status}).`
  )
}

console.log(
  `Synced ${workerEnvironmentNames.length} worker env vars to Trigger ${environment}.`
)
