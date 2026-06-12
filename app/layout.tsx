import type { Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { GeistPixelSquare } from "geist/font/pixel"
import { ClerkProvider } from "@clerk/nextjs"

import "./globals.css"
import { ConvexClientProvider } from "@/components/providers/convex-client-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { cn } from "@/lib/shared/utils"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Extend behind the notch/home indicator so we can opt back in with
  // safe-area insets. Let the keyboard resize the layout viewport so the chat
  // shell does not need to chase visual viewport events in JavaScript.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
}

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        GeistPixelSquare.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ClerkProvider>
          <ConvexClientProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
