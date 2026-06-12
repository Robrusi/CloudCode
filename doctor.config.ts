import type { ReactDoctorConfig } from "react-doctor/api"

export default {
  ignore: {
    rules: ["deslop/unused-dependency"],
    files: [
      // Convex source files are deployment entry points resolved by Convex,
      // outside React Doctor's import graph.
      "convex/**",
    ],
    overrides: [
      {
        files: ["trigger/cloudcode-run.ts"],
        rules: ["deslop/unused-export"],
      },
    ],
  },
} satisfies ReactDoctorConfig
