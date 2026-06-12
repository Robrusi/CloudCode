import type { Message } from "@/components/chat/types"
import { CHAT_IMAGE_ATTACHMENT_MIME_TYPES } from "@/lib/chat/attachments"

export const REPO_KEY = "cloudcode:repoUrl"
export const BASE_BRANCH_KEY = "cloudcode:baseBranch"
export const BRANCH_MODE_KEY = "cloudcode:branchMode"
export const BRANCH_NAME_KEY = "cloudcode:branchName"
export const MODEL_KEY = "cloudcode:model"
export const PRESET_KEY = "cloudcode:sandboxPresetId"
export const SPEED_KEY = "cloudcode:speed"
export const THINKING_KEY = "cloudcode:thinking"
export const ACTIVE_KEY = "cloudcode:activeChatId"
export const TERMINAL_OPEN_KEY = "cloudcode:terminalOpen"

export const DRAFT_RUN_KEY = "__draft__"
export const EMPTY_MESSAGES: Message[] = []
export const CHAT_IMAGE_ATTACHMENT_ACCEPT =
  CHAT_IMAGE_ATTACHMENT_MIME_TYPES.join(",")
export const IMAGE_ONLY_PROMPT = "Please inspect the attached image(s)."
