import type { CodexAuthAccountStatus } from "@/lib/codex/auth-types"

export type ChatGPTConnectionState = {
  disconnectingProfile: string | null
  draftDisplayName: string
  editingProfile: string | null
  pendingDisconnectAccount: CodexAuthAccountStatus | null
  renamingProfile: string | null
  switchError: string
  switchingProfile: string | null
}

export type ChatGPTConnectionAction =
  | { type: "disconnect-finish" }
  | { profile: string; type: "disconnect-start" }
  | { profile: string; type: "disconnect-success" }
  | { account: CodexAuthAccountStatus | null; type: "set-pending-disconnect" }
  | { error: string; type: "set-error" }
  | { type: "rename-cancel" }
  | { account: CodexAuthAccountStatus; type: "rename-open" }
  | { profile: string; type: "rename-start" }
  | { type: "rename-success" }
  | { type: "rename-finish" }
  | { type: "select-finish" }
  | { profile: string; type: "select-start" }
  | { type: "set-draft-display-name"; value: string }

export const initialChatGPTConnectionState: ChatGPTConnectionState = {
  disconnectingProfile: null,
  draftDisplayName: "",
  editingProfile: null,
  pendingDisconnectAccount: null,
  renamingProfile: null,
  switchError: "",
  switchingProfile: null,
}

export function chatGPTConnectionReducer(
  state: ChatGPTConnectionState,
  action: ChatGPTConnectionAction
): ChatGPTConnectionState {
  switch (action.type) {
    case "disconnect-finish":
      return { ...state, disconnectingProfile: null }
    case "disconnect-start":
      return {
        ...state,
        disconnectingProfile: action.profile,
        pendingDisconnectAccount: null,
        switchError: "",
      }
    case "disconnect-success":
      return state.editingProfile === action.profile
        ? { ...state, draftDisplayName: "", editingProfile: null }
        : state
    case "rename-cancel":
      return { ...state, draftDisplayName: "", editingProfile: null }
    case "rename-finish":
      return { ...state, renamingProfile: null }
    case "rename-open":
      return {
        ...state,
        draftDisplayName: action.account.displayName ?? "",
        editingProfile: action.account.profile,
        switchError: "",
      }
    case "rename-start":
      return {
        ...state,
        renamingProfile: action.profile,
        switchError: "",
      }
    case "rename-success":
      return { ...state, draftDisplayName: "", editingProfile: null }
    case "select-finish":
      return { ...state, switchingProfile: null }
    case "select-start":
      return {
        ...state,
        switchError: "",
        switchingProfile: action.profile,
      }
    case "set-draft-display-name":
      return { ...state, draftDisplayName: action.value }
    case "set-error":
      return { ...state, switchError: action.error }
    case "set-pending-disconnect":
      return { ...state, pendingDisconnectAccount: action.account }
  }
}

export function codexAccountTitle(account: CodexAuthAccountStatus) {
  return (
    account.displayName ||
    account.accountEmail ||
    account.accountName ||
    (account.accountId
      ? `Account ${shortAccountId(account.accountId)}`
      : null) ||
    account.profile
  )
}

export function codexAccountSubtitle(account: CodexAuthAccountStatus) {
  const label =
    account.accountEmail && account.accountName
      ? account.accountName
      : account.profile === "default"
        ? "Default profile"
        : account.profile

  return account.accountId
    ? `${label} - ${shortAccountId(account.accountId)}`
    : label
}

function shortAccountId(accountId: string) {
  return accountId.length <= 12
    ? accountId
    : `${accountId.slice(0, 4)}...${accountId.slice(-6)}`
}
