export const INTEGRATION_MCP_SERVERS = {
  linear: {
    description:
      "Find, create, and update Linear issues, projects, and comments.",
    name: "Linear",
    serverName: "linear",
    url: "https://mcp.linear.app/mcp",
  },
  slack: {
    description: "Search Slack context and collaborate in conversations.",
    name: "Slack",
    serverName: "slack",
    url: "https://mcp.slack.com/mcp",
  },
} as const

/** User scopes used by Slack's official MCP server. Bot scopes remain
 * separate and are returned by the same OAuth exchange. */
export const SLACK_MCP_USER_SCOPES = [
  "canvases:read",
  "canvases:write",
  "channels:history",
  "channels:read",
  "channels:write",
  "chat:write",
  "emoji:read",
  "files:read",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "reactions:write",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
  "users:read",
  "users:read.email",
] as const
