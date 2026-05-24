const HTML_ESCAPE_MAP: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
}

export function escapeHtml(value: string) {
  return value.replace(/["&'<>]/g, (char) => HTML_ESCAPE_MAP[char] ?? char)
}
