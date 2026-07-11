import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isProtectedRoute = createRouteMatcher([
  "/api/codex-auth(.*)",
  "/api/codex-run(.*)",
  "/api/chats(.*)",
  "/api/github(.*)",
  "/api/sandbox(.*)",
])
const isGitHubWebhookRoute = createRouteMatcher(["/api/github/webhook"])

export default clerkMiddleware(async (auth, request) => {
  // GitHub cannot present a Clerk session. The webhook route authenticates
  // deliveries with GitHub's HMAC signature over the raw request body.
  if (isProtectedRoute(request) && !isGitHubWebhookRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
