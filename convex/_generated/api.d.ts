/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as automations from "../automations.js";
import type * as billing from "../billing.js";
import type * as billingAutumn from "../billingAutumn.js";
import type * as billingPlan from "../billingPlan.js";
import type * as billingSandboxSegments from "../billingSandboxSegments.js";
import type * as billingUsageEvents from "../billingUsageEvents.js";
import type * as chats from "../chats.js";
import type * as codexAuth from "../codexAuth.js";
import type * as codexRuns from "../codexRuns.js";
import type * as factory from "../factory.js";
import type * as files from "../files.js";
import type * as githubApp from "../githubApp.js";
import type * as integrations from "../integrations.js";
import type * as lib_automationRecords from "../lib/automationRecords.js";
import type * as lib_codexRunAuth from "../lib/codexRunAuth.js";
import type * as lib_codexRunLifecycle from "../lib/codexRunLifecycle.js";
import type * as lib_codexRunLogs from "../lib/codexRunLogs.js";
import type * as lib_codexRunRecords from "../lib/codexRunRecords.js";
import type * as lib_codexRunValidators from "../lib/codexRunValidators.js";
import type * as lib_codexRunWorkerInput from "../lib/codexRunWorkerInput.js";
import type * as lib_envNameValidation from "../lib/envNameValidation.js";
import type * as lib_factoryAccess from "../lib/factoryAccess.js";
import type * as lib_factoryRuns from "../lib/factoryRuns.js";
import type * as lib_factoryWake from "../lib/factoryWake.js";
import type * as lib_integrationMcp from "../lib/integrationMcp.js";
import type * as lib_integrationTriggers from "../lib/integrationTriggers.js";
import type * as lib_mcpServerRecords from "../lib/mcpServerRecords.js";
import type * as lib_mcpServerValidation from "../lib/mcpServerValidation.js";
import type * as lib_reviewRecords from "../lib/reviewRecords.js";
import type * as lib_sandboxAccess from "../lib/sandboxAccess.js";
import type * as lib_sandboxPresetBuilds from "../lib/sandboxPresetBuilds.js";
import type * as lib_sandboxPresetConstants from "../lib/sandboxPresetConstants.js";
import type * as lib_sandboxPresetRecords from "../lib/sandboxPresetRecords.js";
import type * as lib_sandboxPresetValidation from "../lib/sandboxPresetValidation.js";
import type * as lib_sandboxPresets from "../lib/sandboxPresets.js";
import type * as lib_threadAccess from "../lib/threadAccess.js";
import type * as lib_threadContinuation from "../lib/threadContinuation.js";
import type * as lib_threadNotes from "../lib/threadNotes.js";
import type * as lib_triggerApi from "../lib/triggerApi.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_workerAuth from "../lib/workerAuth.js";
import type * as mcpOauthConnections from "../mcpOauthConnections.js";
import type * as mcpServers from "../mcpServers.js";
import type * as reviews from "../reviews.js";
import type * as sandboxPresets from "../sandboxPresets.js";
import type * as sshAccess from "../sshAccess.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  automations: typeof automations;
  billing: typeof billing;
  billingAutumn: typeof billingAutumn;
  billingPlan: typeof billingPlan;
  billingSandboxSegments: typeof billingSandboxSegments;
  billingUsageEvents: typeof billingUsageEvents;
  chats: typeof chats;
  codexAuth: typeof codexAuth;
  codexRuns: typeof codexRuns;
  factory: typeof factory;
  files: typeof files;
  githubApp: typeof githubApp;
  integrations: typeof integrations;
  "lib/automationRecords": typeof lib_automationRecords;
  "lib/codexRunAuth": typeof lib_codexRunAuth;
  "lib/codexRunLifecycle": typeof lib_codexRunLifecycle;
  "lib/codexRunLogs": typeof lib_codexRunLogs;
  "lib/codexRunRecords": typeof lib_codexRunRecords;
  "lib/codexRunValidators": typeof lib_codexRunValidators;
  "lib/codexRunWorkerInput": typeof lib_codexRunWorkerInput;
  "lib/envNameValidation": typeof lib_envNameValidation;
  "lib/factoryAccess": typeof lib_factoryAccess;
  "lib/factoryRuns": typeof lib_factoryRuns;
  "lib/factoryWake": typeof lib_factoryWake;
  "lib/integrationMcp": typeof lib_integrationMcp;
  "lib/integrationTriggers": typeof lib_integrationTriggers;
  "lib/mcpServerRecords": typeof lib_mcpServerRecords;
  "lib/mcpServerValidation": typeof lib_mcpServerValidation;
  "lib/reviewRecords": typeof lib_reviewRecords;
  "lib/sandboxAccess": typeof lib_sandboxAccess;
  "lib/sandboxPresetBuilds": typeof lib_sandboxPresetBuilds;
  "lib/sandboxPresetConstants": typeof lib_sandboxPresetConstants;
  "lib/sandboxPresetRecords": typeof lib_sandboxPresetRecords;
  "lib/sandboxPresetValidation": typeof lib_sandboxPresetValidation;
  "lib/sandboxPresets": typeof lib_sandboxPresets;
  "lib/threadAccess": typeof lib_threadAccess;
  "lib/threadContinuation": typeof lib_threadContinuation;
  "lib/threadNotes": typeof lib_threadNotes;
  "lib/triggerApi": typeof lib_triggerApi;
  "lib/users": typeof lib_users;
  "lib/workerAuth": typeof lib_workerAuth;
  mcpOauthConnections: typeof mcpOauthConnections;
  mcpServers: typeof mcpServers;
  reviews: typeof reviews;
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
