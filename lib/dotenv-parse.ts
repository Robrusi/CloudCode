// Shared `.env` parser used by the settings UI (paste import) and the secrets
// API route. Kept free of server-only imports so it can run in the browser and
// in Node request handlers alike. Mirrors the name validation enforced by the
// Convex `upsertSecret` mutation so a parsed result always saves cleanly.

export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type ParsedEnvVar = {
  name: string
  value: string
}

export type DotenvParseError = {
  content: string
  line: number
  reason: string
}

export type DotenvParseResult = {
  errors: DotenvParseError[]
  vars: ParsedEnvVar[]
}

const NAME_VALUE_PATTERN = /^\s*(?:export\s+)?([^=]+?)\s*=\s*(.*)$/

function unescapeDoubleQuoted(value: string) {
  return value.replace(/\\([nrt\\"'`$])/g, (_match, char: string) => {
    switch (char) {
      case "n":
        return "\n"
      case "r":
        return "\r"
      case "t":
        return "\t"
      default:
        return char
    }
  })
}

function stripInlineComment(value: string) {
  // Only treat `#` as a comment when preceded by whitespace, so values like
  // `pass#word` survive while `value # note` drops the trailing note.
  const match = value.match(/\s+#.*$/)
  if (match && match.index !== undefined) {
    return value.slice(0, match.index)
  }
  return value
}

function findClosingQuote(text: string, quote: string) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === "\\" && quote === '"') {
      index += 1
      continue
    }
    if (char === quote) return index
  }
  return -1
}

/**
 * Parse `.env`-style text into name/value pairs. Supports `export` prefixes,
 * single- and double-quoted values (including multi-line quoted values such as
 * private keys), `\n`/`\t` escapes inside double quotes, inline comments on
 * unquoted values, and `#` comment / blank lines. Invalid lines are collected
 * in `errors` instead of aborting the whole parse.
 */
export function parseDotenv(input: string): DotenvParseResult {
  const vars: ParsedEnvVar[] = []
  const errors: DotenvParseError[] = []
  const lines = input.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const lineNumber = index + 1
    const leading = raw.trimStart()
    if (!leading || leading.startsWith("#")) continue

    const match = raw.match(NAME_VALUE_PATTERN)
    if (!match) {
      errors.push({
        content: raw.trim(),
        line: lineNumber,
        reason: "Expected a NAME=value line.",
      })
      continue
    }

    const name = match[1].trim()
    if (!ENV_NAME_PATTERN.test(name)) {
      errors.push({
        content: raw.trim(),
        line: lineNumber,
        reason: `"${name}" is not a valid variable name.`,
      })
      continue
    }

    const rest = match[2]
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : ""

    if (!quote) {
      vars.push({ name, value: stripInlineComment(rest).trim() })
      continue
    }

    const firstLineBody = rest.slice(1)
    const closeIndex = findClosingQuote(firstLineBody, quote)
    let body: string

    if (closeIndex !== -1) {
      body = firstLineBody.slice(0, closeIndex)
    } else {
      const collected = [firstLineBody]
      while (index + 1 < lines.length) {
        index += 1
        const next = lines[index]
        const nextClose = findClosingQuote(next, quote)
        if (nextClose !== -1) {
          collected.push(next.slice(0, nextClose))
          break
        }
        collected.push(next)
      }
      body = collected.join("\n")
    }

    vars.push({
      name,
      value: quote === '"' ? unescapeDoubleQuoted(body) : body,
    })
  }

  return { errors, vars }
}

/**
 * Collapse duplicate names, keeping the last occurrence (standard `.env`
 * last-write-wins semantics).
 */
export function dedupeEnvVars(vars: ParsedEnvVar[]): ParsedEnvVar[] {
  const byName = new Map<string, ParsedEnvVar>()
  for (const entry of vars) {
    byName.set(entry.name, entry)
  }
  return Array.from(byName.values())
}
