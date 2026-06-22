"use client"

import { Download, Play } from "lucide-react"

import { RecordingVideo } from "@/components/sandbox/recording-video"
import { recordingRequestUrl } from "@/components/sandbox/recording-video-utils"
import { SandboxDesktopIconLink } from "@/components/sandbox/desktop-controls"
import {
  formatRecordingMeta,
  isActiveRecording,
  recordingTitle,
  type DesktopRecording,
} from "@/components/sandbox/desktop-model"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export function RecordingsView({
  recordings,
  sandboxId,
}: {
  recordings: DesktopRecording[]
  sandboxId: string | null
}) {
  if (!recordings.length || !sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground/85">
          No recordings yet
        </p>
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          Recordings captured of the desktop will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto p-3">
      {recordings.map((recording) => (
        <RecordingRow
          key={recording.id}
          recording={recording}
          sandboxId={sandboxId}
        />
      ))}
    </div>
  )
}

function RecordingRow({
  recording,
  sandboxId,
}: {
  recording: DesktopRecording
  sandboxId: string
}) {
  const live = isActiveRecording(recording)
  const meta = formatRecordingMeta(recording)
  const title = recordingTitle(recording)
  const downloadUrl = recordingRequestUrl(recording, {
    inline: false,
    sandboxId,
  })

  return (
    <div
      className={cn("overflow-hidden", cardSurfaceClass, "bg-background/40")}
    >
      <div className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            live
              ? "bg-destructive/10 text-destructive"
              : "bg-sidebar-accent/60 text-muted-foreground"
          )}
        >
          {live ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : (
            <Play className="size-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/85">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {live ? "Recording..." : meta || "Ready"}
          </p>
        </div>
        {!live ? (
          <SandboxDesktopIconLink
            href={downloadUrl ?? "#"}
            label={`Download ${title}`}
          >
            <Download className="size-3.5" />
          </SandboxDesktopIconLink>
        ) : null}
      </div>
      {!live ? (
        <div className="border-t border-border/60 bg-muted/30 p-2">
          {/* Recordings only appear here while the sandbox is running, so
              auto-load is always safe and never starts a stopped sandbox. */}
          <RecordingVideo
            autoLoad
            aria-label={`Recording: ${title}`}
            recording={recording}
            sandboxId={sandboxId}
          />
        </div>
      ) : null}
    </div>
  )
}
