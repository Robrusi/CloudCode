const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  css: "CSS",
  diff: "Diff",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  plaintext: "Plain text",
  python: "Python",
  py: "Python",
  sh: "Shell",
  shell: "Shell",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  go: "Go",
  java: "Java",
  rb: "Ruby",
  ruby: "Ruby",
  rs: "Rust",
  rust: "Rust",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
}

const PIERRE_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  md: "markdown",
  plaintext: "text",
  py: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  yml: "yaml",
  rb: "ruby",
  rs: "rust",
  go: "go",
}

const FILE_EXTENSION_LANGUAGES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
}

export function languageForFilePath(path: string) {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return (ext && FILE_EXTENSION_LANGUAGES[ext]) || "plaintext"
}

export function formatCodeLanguage(lang: string) {
  return CODE_LANGUAGE_LABELS[lang] ?? lang
}

export function getPierreLanguage(lang: string) {
  return PIERRE_LANGUAGE_ALIASES[lang] ?? lang
}
