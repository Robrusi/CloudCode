import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function extractGeneratedMethods(source: string) {
  return Array.from(
    source.matchAll(/"method": "([^"]+)"/g),
    (match) => match[1]!
  )
}

function extractSwitchCases(source: string) {
  return new Set(
    Array.from(source.matchAll(/case "([^"]+)"/g), (match) => match[1]!)
  )
}

function sourceSlice(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)

  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)

  return source.slice(startIndex, endIndex)
}

function missingMethods(generated: string[], handled: Set<string>) {
  return generated.filter((method) => !handled.has(method))
}

const generatedDir = await mkdtemp(join(tmpdir(), "cloudcode-codex-protocol-"))

try {
  await execFileAsync("codex", [
    "app-server",
    "generate-ts",
    "--out",
    generatedDir,
  ])

  const [
    notificationsSource,
    requestsSource,
    requestHandlerSource,
    turnReducerSource,
  ] = await Promise.all([
    readFile(join(generatedDir, "ServerNotification.ts"), "utf8"),
    readFile(join(generatedDir, "ServerRequest.ts"), "utf8"),
    readFile(
      new URL("../lib/codex/app-server-requests.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../lib/codex/app-server-turn-reducer.ts", import.meta.url),
      "utf8"
    ),
  ])

  const generatedNotifications = extractGeneratedMethods(notificationsSource)
  const generatedRequests = extractGeneratedMethods(requestsSource)
  const reducerCases = extractSwitchCases(turnReducerSource)
  const requestHandlerCases = extractSwitchCases(
    sourceSlice(
      requestHandlerSource,
      "export async function codexAppServerRequestResult",
      "function emptyToolInputAnswers"
    )
  )

  const missingNotifications = missingMethods(
    generatedNotifications,
    reducerCases
  )
  const missingRequests = missingMethods(generatedRequests, requestHandlerCases)

  assert.deepEqual(missingNotifications, [])
  assert.deepEqual(missingRequests, [])

  console.log(
    JSON.stringify(
      {
        generatedNotifications: generatedNotifications.length,
        generatedRequests: generatedRequests.length,
        ok: true,
      },
      null,
      2
    )
  )
} finally {
  await rm(generatedDir, { force: true, recursive: true }).catch(
    () => undefined
  )
}
