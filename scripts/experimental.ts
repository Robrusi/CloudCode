import { Daytona } from "@daytona/sdk"

const daytona = new Daytona({
  target: process.env.DAYTONA_TARGET,
  apiKey: process.env.DAYTONA_API_KEY,
})

const sandbox = await daytona.create({
  snapshot: "cloudcode-batteries-included",
})

await sandbox.resize({
  cpu: 4,
  memory: 2,
})

console.log(sandbox.state)
console.log(sandbox.name)
console.log(
  `${sandbox.cpu} CPU, ${sandbox.memory} GiB RAM, ${sandbox.disk} GiB disk`
)
