export const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"] as const
export type Model = (typeof MODELS)[number]

export const SPEEDS = ["standard", "fast"] as const
export type Speed = (typeof SPEEDS)[number]

export const THINKINGS = ["none", "low", "medium", "high", "xhigh"] as const
export type Thinking = (typeof THINKINGS)[number]

export const DEFAULT_SANDBOX_CPU_COUNT = 2
export const DEFAULT_SANDBOX_MEMORY_MB = 2048
export const SANDBOX_SIZE_OPTIONS = [
  {
    cpuCount: 2,
    id: "normal",
    label: "Normal",
    memoryMB: 2048,
  },
  {
    cpuCount: 4,
    id: "large",
    label: "Large",
    memoryMB: 4096,
  },
  {
    cpuCount: 8,
    id: "xlarge",
    label: "XLarge",
    memoryMB: 8192,
  },
] as const

export const MODEL_LABEL: Record<Model, string> = {
  "gpt-5.5": "GPT 5.5",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.4-mini": "GPT 5.4-mini",
}

export const SPEED_LABEL: Record<Speed, string> = {
  standard: "Standard",
  fast: "Fast",
}

export const THINKING_LABEL: Record<Thinking, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
}

export const PRESET_TOOLS = [
  {
    description:
      "Uses mise to install versions detected from repo config files.",
    id: "auto-detect",
    label: "Auto-detect",
  },
  {
    description: "Installs Bun into the sandbox user profile.",
    id: "bun",
    label: "Bun",
  },
  {
    description: "Clones Flutter stable into the sandbox user profile.",
    id: "flutter",
    label: "Flutter",
  },
  {
    description: "Enables pnpm through Corepack or npm.",
    id: "node-pnpm",
    label: "Node + pnpm",
  },
  {
    description: "Verifies Python and pip availability.",
    id: "python",
    label: "Python",
  },
  {
    description: "Verifies Go availability in the base image.",
    id: "go",
    label: "Go",
  },
  {
    description: "Installs Rust through rustup when needed.",
    id: "rust",
    label: "Rust",
  },
  {
    description: "Installs the uv Python package and project manager.",
    id: "uv",
    label: "uv",
  },
  {
    description: "Installs Miniconda for managing conda environments.",
    id: "conda",
    label: "Conda",
  },
  {
    description: "Installs Ruby and Bundler via apt when needed.",
    id: "ruby",
    label: "Ruby",
  },
  {
    description: "Installs the Temurin JDK (Java) via apt when needed.",
    id: "java",
    label: "Java",
  },
  {
    description: "Installs Kotlin through SDKMAN (requires Java).",
    id: "kotlin",
    label: "Kotlin",
  },
  {
    description: "Installs the .NET SDK via the official install script.",
    id: "dotnet",
    label: ".NET",
  },
  {
    description: "Installs Elixir and Erlang/OTP via apt when needed.",
    id: "elixir",
    label: "Elixir",
  },
  {
    description: "Downloads the latest Zig release tarball.",
    id: "zig",
    label: "Zig",
  },
  {
    description: "Downloads the latest Swift Linux toolchain.",
    id: "swift",
    label: "Swift",
  },
] as const

export function shortModel(m: Model) {
  return m.replace(/^gpt-/, "")
}

export function memoryLabel(memoryMB: number) {
  return memoryMB >= 1024 && memoryMB % 1024 === 0
    ? `${memoryMB / 1024} GB`
    : `${memoryMB} MB`
}
