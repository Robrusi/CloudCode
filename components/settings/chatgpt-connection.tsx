"use client"

import { FileUp, KeyRound, LogIn } from "lucide-react"
import { useReducer } from "react"

import { ChatGPTAccountEditRow } from "@/components/settings/chatgpt-account-edit-row"
import { ChatGPTAccountRow } from "@/components/settings/chatgpt-account-row"
import { ChatGPTApiKeyDialog } from "@/components/settings/chatgpt-apikey-dialog"
import { ChatGPTImportDialog } from "@/components/settings/chatgpt-import-dialog"
import {
  chatGPTConnectionReducer,
  codexAccountTitle,
  initialChatGPTConnectionState,
} from "@/components/settings/chatgpt-model"
import { SettingsConfirmDialog } from "@/components/settings/shared"
import { OpenAIIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { useCodexAuthWindow } from "@/hooks/use-codex-auth-window"
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
    error: loginError,
    opening: loginOpening,
    start: startLogin,
  } = useCodexAuthWindow({
    onComplete: onCodexAuthChanged,
  })
  const {
    apiKeyError,
    apiKeyOpen,
    apiKeySaving,
    apiKeyValue,
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
  const detail = connected
    ? activeAccount?.invalidatedAt
      ? "Sign in again before starting another Codex run."
      : activeAccount
        ? `Using ${codexAccountTitle(activeAccount)}`
        : "ChatGPT is connected. Codex runs are authorized."
    : "Sign in with ChatGPT"
  const visibleError = loginError || switchError || authError

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

  async function saveApiKey() {
    if (apiKeySaving) return

    const apiKey = apiKeyValue.trim()
    if (!apiKey) return

    dispatch({ type: "apikey-start" })

    try {
      await requestJson(
        "/api/codex-auth",
        "POST",
        { apiKey },
        {
          fallbackError: "Unable to save API key.",
        }
      )

      dispatch({ type: "apikey-success" })
      await onCodexAuthChanged()
    } catch (error) {
      dispatch({
        error:
          error instanceof Error ? error.message : "Unable to save API key.",
        type: "apikey-error",
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <OpenAIIcon className="size-5 shrink-0 text-foreground/80" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">ChatGPT</div>
            <div className="text-xs text-muted-foreground">{detail}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => dispatch({ type: "import-open" })}
          >
            <FileUp className="size-3.5" />
            Import auth.json
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => dispatch({ type: "apikey-open" })}
          >
            <KeyRound className="size-3.5" />
            Add API key
          </Button>
          <Button
            type="button"
            variant={
              connected && !activeAccount?.invalidatedAt ? "ghost" : "default"
            }
            size="sm"
            className="gap-1.5"
            disabled={loginOpening}
            onClick={startLogin}
          >
            <LogIn className="size-3.5" />
            {loginOpening ? "Opening..." : "Sign in"}
          </Button>
        </div>
      </div>
      {status?.invalidatedAt ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          Sign in again or import a fresh auth.json before starting another
          Codex run.
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
      {apiKeyOpen ? (
        <ChatGPTApiKeyDialog
          value={apiKeyValue}
          busy={apiKeySaving}
          error={apiKeyError}
          onValueChange={(value) =>
            dispatch({ type: "apikey-set-value", value })
          }
          onConfirm={() => void saveApiKey()}
          onCancel={() => dispatch({ type: "apikey-close" })}
        />
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
