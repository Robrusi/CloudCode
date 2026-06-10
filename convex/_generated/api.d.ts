/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as billing from "../billing.js";
import type * as chats from "../chats.js";
import type * as codexAuth from "../codexAuth.js";
import type * as codexRuns from "../codexRuns.js";
import type * as files from "../files.js";
import type * as githubApp from "../githubApp.js";
import type * as lib_sandboxAccess from "../lib/sandboxAccess.js";
import type * as lib_sandboxPresets from "../lib/sandboxPresets.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_workerAuth from "../lib/workerAuth.js";
import type * as mcpServers from "../mcpServers.js";
import type * as sandboxPresets from "../sandboxPresets.js";
import type * as sshAccess from "../sshAccess.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  billing: typeof billing;
  chats: typeof chats;
  codexAuth: typeof codexAuth;
  codexRuns: typeof codexRuns;
  files: typeof files;
  githubApp: typeof githubApp;
  "lib/sandboxAccess": typeof lib_sandboxAccess;
  "lib/sandboxPresets": typeof lib_sandboxPresets;
  "lib/users": typeof lib_users;
  "lib/workerAuth": typeof lib_workerAuth;
  mcpServers: typeof mcpServers;
  sandboxPresets: typeof sandboxPresets;
  sshAccess: typeof sshAccess;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
