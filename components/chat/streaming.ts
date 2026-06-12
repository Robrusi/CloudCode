const STREAM_TOOL_MARKER_REGEX = /<codex-tool>[\s\S]*?<\/codex-tool>/g
const TEXT_STREAMING_TOKEN_REGEX = /\s+|[^\s]+/g

export function splitStreamingTokens(delta: string) {
  const tokens: string[] = []
  let last = 0
  let match: RegExpExecArray | null

  STREAM_TOOL_MARKER_REGEX.lastIndex = 0
  while ((match = STREAM_TOOL_MARKER_REGEX.exec(delta)) !== null) {
    if (match.index > last) {
      tokens.push(...splitTextStreamingTokens(delta.slice(last, match.index)))
    }
    tokens.push(match[0])
    last = match.index + match[0].length
  }

  if (last < delta.length) {
    tokens.push(...splitTextStreamingTokens(delta.slice(last)))
  }

  return tokens
}

function splitTextStreamingTokens(delta: string) {
  return delta.match(TEXT_STREAMING_TOKEN_REGEX) ?? [delta]
}
