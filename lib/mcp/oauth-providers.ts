// Slack and Linear are intentionally absent: they are first-class chat
// integrations (lib/integrations/*) with their own webhooks, agent sessions,
// and automation triggers, not MCP tool servers.
export type McpOauthProviderId =
  | "airtable"
  | "apollo_io"
  | "asana"
  | "atlassian"
  | "attio"
  | "cloudflare"
  | "datadog"
  | "gmail"
  | "granola"
  | "hubspot"
  | "notion"
  | "posthog"
  | "pylon"
  | "sentry"
  | "stripe"
  | "supabase"
  | "vercel"
  | "x"

export type McpClientSecretAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"

export type McpOauthProvider = {
  clientSecretAuthMethod?: McpClientSecretAuthMethod
  description: string
  id: McpOauthProviderId
  name: string
  // Set for providers whose MCP server does not publish OAuth discovery
  // metadata (RFC 9728); the OAuth endpoints are pinned here instead of
  // being discovered from the server.
  staticAuthorizationServer?: {
    authorizationEndpoint: string
    revocationEndpoint?: string
    scope?: string
    tokenEndpoint: string
  }
  // Set for providers whose authorization server does not support dynamic
  // client registration. The OAuth client must be registered manually with
  // the provider; its credentials are pasted in the setup dialog (stored
  // encrypted per user) or preconfigured through these env vars.
  staticClientEnv?: {
    clientIdVar: string
    clientSecretVar: string
    // Developer console where the OAuth app is created; linked from the
    // in-app setup instructions.
    consoleUrl: string
    // One concrete sentence describing where in the console to click,
    // rendered under the first setup step.
    setupHint: string
  }
  // Two-or-three word summary shown on the connect tile.
  tagline: string
  url: string
}

export const MCP_OAUTH_PROVIDERS: McpOauthProvider[] = [
  {
    description: "Read and update Airtable bases, tables, and records.",
    id: "airtable",
    tagline: "Bases & records",
    name: "Airtable",
    url: "https://mcp.airtable.com/mcp",
  },
  {
    description: "Search Apollo prospects, companies, contacts, and sequences.",
    id: "apollo_io",
    tagline: "Prospects & sequences",
    name: "Apollo.io",
    url: "https://mcp.apollo.io/mcp",
  },
  {
    description: "Search and manage Asana tasks and projects.",
    id: "asana",
    tagline: "Tasks & projects",
    name: "Asana",
    staticClientEnv: {
      clientIdVar: "ASANA_MCP_CLIENT_ID",
      clientSecretVar: "ASANA_MCP_CLIENT_SECRET",
      consoleUrl: "https://app.asana.com/0/developer-console",
      setupHint:
        "Click 'Create new app', name it anything (for example 'Cloudcode'), then open the app's OAuth section to add the redirect URL and copy the client ID and secret.",
    },
    url: "https://mcp.asana.com/v2/mcp",
  },
  {
    description: "Jira issues, Confluence pages, and Jira Service Management.",
    id: "atlassian",
    tagline: "Jira & Confluence",
    name: "Atlassian",
    url: "https://mcp.atlassian.com/v1/mcp/authv2",
  },
  {
    description:
      "Search and update Attio CRM records, notes, tasks, and calls.",
    id: "attio",
    tagline: "CRM & notes",
    name: "Attio",
    url: "https://mcp.attio.com/mcp",
  },
  {
    description: "Cloudflare Workers bindings: D1, R2, KV, and more.",
    id: "cloudflare",
    tagline: "Workers & storage",
    name: "Cloudflare",
    url: "https://bindings.mcp.cloudflare.com/mcp",
  },
  {
    description:
      "Query Datadog logs, metrics, traces, dashboards, and monitors.",
    id: "datadog",
    tagline: "Core observability",
    name: "Datadog",
    url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
  },
  {
    description: "Search Gmail threads and create drafts from your mailbox.",
    id: "gmail",
    tagline: "Mail & drafts",
    name: "Gmail",
    staticClientEnv: {
      clientIdVar: "GMAIL_MCP_CLIENT_ID",
      clientSecretVar: "GMAIL_MCP_CLIENT_SECRET",
      consoleUrl: "https://console.cloud.google.com/apis/credentials",
      setupHint:
        "Click 'Create credentials' → 'OAuth client ID', pick 'Web application', and add the redirect URL as an authorized redirect URI. Google shows the client ID and secret right after creating it.",
    },
    url: "https://gmailmcp.googleapis.com/mcp/v1",
  },
  {
    description: "Reference Granola meeting notes, transcripts, and summaries.",
    id: "granola",
    tagline: "Meeting notes",
    name: "Granola",
    url: "https://mcp.granola.ai/mcp",
  },
  {
    clientSecretAuthMethod: "client_secret_post",
    description: "Read and write HubSpot CRM records, activities, and content.",
    id: "hubspot",
    tagline: "CRM & activities",
    name: "HubSpot",
    staticClientEnv: {
      clientIdVar: "HUBSPOT_MCP_CLIENT_ID",
      clientSecretVar: "HUBSPOT_MCP_CLIENT_SECRET",
      consoleUrl: "https://developers.hubspot.com",
      setupHint:
        "In your developer account, create an app, open its Auth tab to add the redirect URL, and copy the client ID and secret from the same tab.",
    },
    url: "https://mcp.hubspot.com",
  },
  {
    description: "Search and update Notion pages and databases.",
    id: "notion",
    tagline: "Pages & databases",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
  },
  {
    description:
      "Inspect PostHog analytics, errors, feature flags, and replays.",
    id: "posthog",
    tagline: "Analytics & flags",
    name: "PostHog",
    url: "https://mcp.posthog.com/mcp",
  },
  {
    description: "Access Pylon issues, accounts, tasks, and support context.",
    id: "pylon",
    tagline: "Support & accounts",
    name: "Pylon",
    url: "https://mcp.usepylon.com/",
  },
  {
    description: "Look up Sentry issues, errors, and traces.",
    id: "sentry",
    tagline: "Errors & traces",
    name: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
  },
  {
    description: "Inspect Stripe customers, payments, and subscriptions.",
    id: "stripe",
    tagline: "Payments & customers",
    name: "Stripe",
    url: "https://mcp.stripe.com",
  },
  {
    description: "Manage Supabase projects, tables, and SQL.",
    id: "supabase",
    tagline: "Postgres & projects",
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
  },
  {
    description: "Inspect Vercel projects, deployments, and logs.",
    id: "vercel",
    tagline: "Deployments & logs",
    name: "Vercel",
    url: "https://mcp.vercel.com",
  },
  {
    description: "Search, read, and post on X (Twitter).",
    id: "x",
    tagline: "Posts & timelines",
    name: "X",
    // X's hosted MCP does not publish OAuth discovery metadata; it uses the
    // regular X API OAuth 2.0 endpoints with a manually registered app.
    staticAuthorizationServer: {
      authorizationEndpoint: "https://x.com/i/oauth2/authorize",
      revocationEndpoint: "https://api.x.com/2/oauth2/revoke",
      scope: "tweet.read tweet.write users.read bookmark.read offline.access",
      tokenEndpoint: "https://api.x.com/2/oauth2/token",
    },
    staticClientEnv: {
      clientIdVar: "X_MCP_CLIENT_ID",
      clientSecretVar: "X_MCP_CLIENT_SECRET",
      consoleUrl: "https://developer.x.com/en/portal/dashboard",
      setupHint:
        "Create a project and app, open the app's 'User authentication settings' → 'Set up', pick OAuth 2.0 with app type 'Web App', add the redirect URL, then copy the OAuth 2.0 client ID and secret.",
    },
    url: "https://api.x.com/mcp",
  },
]

export function mcpOauthProvider(id: string | null | undefined) {
  return MCP_OAUTH_PROVIDERS.find((provider) => provider.id === id) ?? null
}
