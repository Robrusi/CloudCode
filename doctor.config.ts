import type { ReactDoctorConfig } from "react-doctor/api"

export default {
  ignore: {
    rules: ["deslop/unused-dependency"],
    files: [
      "convex/_generated/**",
      "convex/schema.ts",
      "convex/chats.ts",
      "convex/codexAuth.ts",
      "convex/codexRuns.ts",
      "convex/lib/users.ts",
      "convex/lib/workerAuth.ts",
      "convex/sandboxPresets.ts",
      "convex/users.ts",
    ],
    overrides: [
      {
        files: ["components/chat.tsx"],
        rules: [
          "react-doctor/no-event-handler",
          "react-doctor/no-derived-state",
          "react-doctor/no-chain-state-updates",
          "react-doctor/no-effect-chain",
          "react-doctor/no-fetch-in-effect",
          "react-doctor/no-giant-component",
          "react-doctor/prefer-useReducer",
        ],
      },
      {
        files: ["components/file-browser.tsx"],
        rules: [
          "react-doctor/no-event-handler",
          "react-doctor/no-pass-data-to-parent",
          "react-doctor/no-pass-live-state-to-parent",
          "react-doctor/no-cascading-set-state",
          "react-doctor/no-giant-component",
          "react-doctor/prefer-useReducer",
        ],
      },
      {
        files: ["components/sandbox-terminal.tsx"],
        rules: [
          "react-doctor/no-adjust-state-on-prop-change",
          "react-doctor/no-cascading-set-state",
          "react-doctor/no-effect-event-handler",
          "react-doctor/no-fetch-in-effect",
          "react-doctor/no-giant-component",
          "react-doctor/rerender-state-only-in-handlers",
        ],
      },
      {
        files: ["components/sandbox-status.tsx"],
        rules: [
          "react-doctor/no-cascading-set-state",
          "react-doctor/no-fetch-in-effect",
        ],
      },
      {
        files: ["components/settings-screen.tsx"],
        rules: [
          "react-doctor/no-giant-component",
          "react-doctor/prefer-useReducer",
        ],
      },
    ],
  },
} satisfies ReactDoctorConfig
