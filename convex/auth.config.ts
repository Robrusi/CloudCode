import type { AuthConfig } from "convex/server"

const clerkIssuer =
  process.env.CLERK_JWT_ISSUER_DOMAIN ??
  (process.env.CLERK_FRONTEND_API_URL
    ? `https://${process.env.CLERK_FRONTEND_API_URL}`
    : undefined)

if (!clerkIssuer) {
  throw new Error(
    "Set CLERK_JWT_ISSUER_DOMAIN in Convex to your Clerk issuer URL."
  )
}

export default {
  providers: [
    {
      applicationID: "convex",
      domain: clerkIssuer,
    },
  ],
} satisfies AuthConfig
