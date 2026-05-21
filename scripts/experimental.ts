import { Daytona } from "@daytona/sdk"

const daytona = new Daytona({
  target: "experimental",
})

const sandbox = await daytona.create({
  snapshot: "cloudcode-empty",
})

await sandbox.git.clone("https://github.com/pingdotgg/t3code", "workspace/repo")

await sandbox._experimental_createSnapshot("t3code")
console.log("Snapshot 't3code' created successfully")

console.log(sandbox.state)
console.log(sandbox.name)
console.log(
  `${sandbox.cpu} CPU, ${sandbox.memory} GiB RAM, ${sandbox.disk} GiB disk`
)

const t3Sandbox = await daytona.create({
  snapshot: "t3code",
})

console.log(t3Sandbox.state)
console.log(t3Sandbox.name)
console.log(
  `${t3Sandbox.cpu} CPU, ${t3Sandbox.memory} GiB RAM, ${t3Sandbox.disk} GiB disk`
)
