export default function Page() {
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <a
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        href="/api/codex-auth/login"
      >
        Sign in with ChatGPT
      </a>
    </main>
  )
}
