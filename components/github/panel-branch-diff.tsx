"use client"

import { ChangedFiles, DiffList } from "@/components/diff/changed-files"

export function BranchDiffSection({
  diff,
  onOpenDiff,
  truncated,
}: {
  diff: string
  onOpenDiff: (path: string) => void
  truncated: boolean
}) {
  return (
    <>
      <ChangedFiles diff={diff} onOpenDiff={onOpenDiff} />
      {truncated ? (
        <p className="pt-2 text-[11px] text-muted-foreground">
          Large diff - some files are omitted below.
        </p>
      ) : null}
      <div className="mt-3">
        <DiffList diff={diff} diffStyle="unified" />
      </div>
    </>
  )
}
