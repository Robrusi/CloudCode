import { Template, defaultBuildLogger } from "e2b"

const baseTemplate = process.env.E2B_CODEX_NORMAL_TEMPLATE ?? "codex"

const sizeTemplates = [
  {
    cpuCount: 4,
    memoryMB: 4096,
    name: process.env.E2B_CODEX_LARGE_TEMPLATE ?? "codex-large",
  },
  {
    cpuCount: 8,
    memoryMB: 8192,
    name: process.env.E2B_CODEX_XLARGE_TEMPLATE ?? "codex-xlarge",
  },
]

async function buildSizeTemplate(sizeTemplate) {
  console.log(
    `Building ${sizeTemplate.name} from ${baseTemplate} (${sizeTemplate.cpuCount} CPU, ${sizeTemplate.memoryMB} MB RAM)`
  )

  const buildInfo = await Template.build(
    Template().fromTemplate(baseTemplate),
    sizeTemplate.name,
    {
      cpuCount: sizeTemplate.cpuCount,
      memoryMB: sizeTemplate.memoryMB,
      onBuildLogs: defaultBuildLogger(),
    }
  )

  console.log(
    `Built ${buildInfo.name ?? sizeTemplate.name}: templateId=${buildInfo.templateId} buildId=${buildInfo.buildId}`
  )
}

async function main() {
  for (const sizeTemplate of sizeTemplates) {
    await buildSizeTemplate(sizeTemplate)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
