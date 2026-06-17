"use client"

import { FileUp, Plus, RefreshCw } from "lucide-react"
import { useReducer } from "react"

import { ChatGPTAccountEditRow } from "@/components/settings/chatgpt-account-edit-row"
import { ChatGPTAccountRow } from "@/components/settings/chatgpt-account-row"
import { ChatGPTImportDialog } from "@/components/settings/chatgpt-import-dialog"
import {
  chatGPTConnectionReducer,
  codexAccountTitle,
  initialChatGPTConnectionState,
} from "@/components/settings/chatgpt-model"
import {
  navAction,
  navPrimary,
  SettingsConfirmDialog,
} from "@/components/settings/shared"
import { OpenAIIcon } from "@/components/ui/brand-icons"
import type {
  CodexAuthAccountStatus,
  CodexAuthOverview,
} from "@/lib/codex/auth-types"
import { requestJson } from "@/lib/http/client-json"

export function ChatGPTConnectionRow({
  status,
  authError,
  onCodexAuthChanged,
}: {
  status: CodexAuthOverview | null
  authError: string
  onCodexAuthChanged: () => void | Promise<void>
}) {
  const [state, dispatch] = useReducer(
    chatGPTConnectionReducer,
    initialChatGPTConnectionState
  )
  const {
    disconnectingProfile,
    draftDisplayName,
    editingProfile,
    importError,
    importing,
    importOpen,
    importValue,
    pendingDisconnectAccount,
    renamingProfile,
    switchError,
    switchingProfile,
  } = state
  const accounts = status?.accounts ?? []
  const activeProfile = status?.activeProfile ?? status?.profile ?? "default"
  const connected = Boolean(status?.exists || accounts.length > 0)
  const activeAccount = accounts.find(
    (account) => account.profile === activeProfile
  )
  const reconnectProfile = activeAccount?.invalidatedAt
    ? activeProfile
    : undefined
  const detail = connected
    ? activeAccount?.invalidatedAt
      ? "Reconnect ChatGPT before starting another Codex run."
      : activeAccount
        ? `Using ${codexAccountTitle(activeAccount)}`
        : "Connected. Codex runs are authorized with ChatGPT."
    : "Sign in with ChatGPT to authorize Codex runs."
  const visibleError = switchError || authError

  async function selectProfile(profile: string) {
    if (profile === activeProfile || switchingProfile || editingProfile) return

    dispatch({ profile, type: "select-start" })

    try {
      await requestJson(
        "/api/codex-auth",
        "PATCH",
        { profile },
        {
          fallbackError: "Unable to switch ChatGPT account.",
        }
      )

      await onCodexAuthChanged()
    } catch (error) {
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : "Unable to switch ChatGPT account.",
        type: "set-error",
      })
    } finally {
      dispatch({ type: "select-finish" })
    }
  }

  async function importAuthJson() {
    if (importing) return

    const authJson = importValue.trim()
    if (!authJson) return

    dispatch({ type: "import-start" })

    try {
      await requestJson(
        "/api/codex-auth",
        "POST",
        { authJson },
        {
          fallbackError: "Unable to import auth.json.",
        }
      )

      dispatch({ type: "import-success" })
      await onCodexAuthChanged()
    } catch (error) {
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : "Unable to import auth.json.",
        type: "import-error",
      })
    }
  }

  function startRename(account: CodexAuthAccountStatus) {
    dispatch({ account, type: "rename-open" })
  }

  async function renameProfile(profile: string) {
    if (renamingProfile) return

    dispatch({ profile, type: "rename-start" })

    try {
      await requestJson(
        "/api/codex-auth",
        "PATCH",
        {
          displayName: draftDisplayName,
          profile,
        },
        {
          fallbackError: "Unable to rename ChatGPT account.",
        }
      )

      await onCodexAuthChanged()
      dispatch({ type: "rename-success" })
    } catch (error) {
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : "Unable to rename ChatGPT account.",
        type: "set-error",
      })
    } finally {
      dispatch({ type: "rename-finish" })
    }
  }

  async function disconnectProfile(account: CodexAuthAccountStatus) {
    if (disconnectingProfile) return

    dispatch({ profile: account.profile, type: "disconnect-start" })

    try {
      await requestJson(
        "/api/codex-auth",
        "DELETE",
        { profile: account.profile },
        {
          fallbackError: "Unable to disconnect ChatGPT account.",
        }
      )

      dispatch({ profile: account.profile, type: "disconnect-success" })
      await onCodexAuthChanged()
    } catch (error) {
      dispatch({
        error:
          error instanceof Error
            ? error.message
            : "Unable to disconnect ChatGPT account.",
        type: "set-error",
      })
    } finally {
      dispatch({ type: "disconnect-finish" })
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <OpenAIIcon className="size-5 shrink-0 text-foreground/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">ChatGPT</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
        <button
          type="button"
          className={navAction}
          onClick={() => dispatch({ type: "import-open" })}
        >
          <FileUp className="size-3.5" />
          Import auth.json
        </button>
        <form action="/api/codex-auth/login" method="get">
          {reconnectProfile ? (
            <input type="hidden" name="profile" value={reconnectProfile} />
          ) : connected ? (
            <input type="hidden" name="add" value="1" />
          ) : null}
          <button
            type="submit"
            className={connected && !reconnectProfile ? navAction : navPrimary}
          >
            {reconnectProfile ? (
              <RefreshCw className="size-3.5" />
            ) : connected ? (
              <Plus className="size-3.5" />
            ) : null}
            {reconnectProfile
              ? "Reconnect"
              : connected
                ? "Add account"
                : "Connect"}
          </button>
        </form>
      </div>
      {status?.invalidatedAt ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          Reconnect ChatGPT before starting another Codex run.
        </div>
      ) : visibleError ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          {visibleError}
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <div className="mt-3 space-y-0.5">
          {accounts.map((account) => {
            const active = account.profile === activeProfile
            const editing = editingProfile === account.profile
            const busy = Boolean(
              switchingProfile || renamingProfile || disconnectingProfile
            )
            const renaming = renamingProfile === account.profile

            if (editing) {
              return (
                <ChatGPTAccountEditRow
                  key={account.profile}
                  account={account}
                  active={active}
                  draftDisplayName={draftDisplayName}
                  renaming={renaming}
                  onCancel={() => dispatch({ type: "rename-cancel" })}
                  onDraftDisplayNameChange={(value) =>
                    dispatch({
                      type: "set-draft-display-name",
                      value,
                    })
                  }
                  onRename={() => void renameProfile(account.profile)}
                />
              )
            }

            return (
              <ChatGPTAccountRow
                key={account.profile}
                account={account}
                active={active}
                busy={busy}
                editingDisabled={Boolean(editingProfile)}
                onDisconnect={() =>
                  dispatch({ account, type: "set-pending-disconnect" })
                }
                onRename={() => startRename(account)}
                onSelect={() => void selectProfile(account.profile)}
              />
            )
          })}
        </div>
      ) : null}
      {importOpen ? (
        <ChatGPTImportDialog
          value={importValue}
          busy={importing}
          error={importError}
          onValueChange={(value) =>
            dispatch({ type: "import-set-value", value })
          }
          onConfirm={() => void importAuthJson()}
          onCancel={() => dispatch({ type: "import-close" })}
        />
      ) : null}
      {pendingDisconnectAccount ? (
        <SettingsConfirmDialog
          title={`Disconnect ${codexAccountTitle(pendingDisconnectAccount)}?`}
          description="Codex runs will stop using this ChatGPT account."
          confirmLabel="Disconnect"
          destructive
          onCancel={() =>
            dispatch({ account: null, type: "set-pending-disconnect" })
          }
          onConfirm={() => void disconnectProfile(pendingDisconnectAccount)}
        />
      ) : null}
    </div>
  )
}
