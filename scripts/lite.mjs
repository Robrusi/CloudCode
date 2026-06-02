import { Daytona, Image } from "@daytona/sdk"

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET,
})

const image = Image.base(
  process.env.DAYTONA_DEFAULT_IMAGE || "daytonaio/sandbox:0.8.0"
).dockerfileCommands(["USER root", "WORKDIR /workspace"])

const snapshot = await daytona.snapshot.create(
  {
    name: "cloudcode-no-downloads",
    image,
    resources: {
      cpu: 2,
      memory: 4,
      disk: 10,
    },
  },
  {
    onLogs: (chunk) => process.stdout.write(chunk),
    timeout: Number(process.env.DAYTONA_CLOUDCODE_SNAPSHOT_TIMEOUT ?? 0),
  }
)

console.log(`Snapshot ready: ${snapshot.name} (${snapshot.state})`)
