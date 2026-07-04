import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { GeistPixelSquare } from "geist/font/pixel"
import { ClerkProvider } from "@clerk/nextjs"

import "./globals.css"
import { ConvexClientProvider } from "@/components/providers/convex-client-provider"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { cn } from "@/lib/shared/utils"

export const metadata: Metadata = {
  title: {
    default: "Cloudcode",
    template: "%s | Cloudcode",
  },
  description: "Chat with Codex in a Daytona sandbox.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cloudcode",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png" }],
  },
}

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
  // Paint the standalone PWA chrome (status bar + home-indicator safe-area
  // band) with the app background instead of the manifest's static color.
  // Without a theme-aware value iOS fills those bands with the manifest
  // theme_color, which in light mode shows as a black strip at the bottom of
  // every screen. Values mirror `--background` (light: white, dark: #0a0a0a).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
      <head>
        {/* Apply the stored accent before first paint so primary controls never
            flash the neutral colour. next-themes handles the light/dark class;
            this mirrors it for the [data-accent] attribute. Preset accents get
            their colour from CSS; the custom accent sets --accent-solid inline
            with a luminance-picked text colour (kept in sync with
            contrastForeground in lib/theme/accent.ts). Unknown values map to no
            CSS rule (= the neutral "mono" default). */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `try{var e=document.documentElement,a=localStorage.getItem('cc-accent');if(a&&a!=='mono')e.setAttribute('data-accent',a);if(a==='custom'){var c=localStorage.getItem('cc-accent-color');if(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c||'')){var h=c.slice(1);if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];var r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;e.style.setProperty('--accent-solid',c);e.style.setProperty('--accent-solid-foreground',0.299*r+0.587*g+0.114*b>0.6?'#0a0a0a':'#ffffff')}}}catch(e){}`,
          }}
        />
      </head>
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
