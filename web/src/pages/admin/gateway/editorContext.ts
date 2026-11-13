// web/src/pages/admin/gateway/editorContext.ts
//
// What every editor tab receives from the section: the parsed config model,
// the live runtime view, and the two ways to change things — a structural
// edit (preview → diff → apply/reload) or an instant runtime action.

import type { ConfigModel, EditOp, RuntimeBackend, RuntimeServer } from "./gatewayApi";

export type EditorCtx = {
  model: ConfigModel | null;
  runtimeServers: Map<string, RuntimeServer>;
  runtimeBackends: Map<string, RuntimeBackend>;
  /** Dry-runs the op and opens the diff preview; throws on validation errors. */
  requestEdit: (op: EditOp) => Promise<void>;
  /** Same as requestEdit, but reports errors in the section instead of throwing. */
  editInline: (op: EditOp) => Promise<void>;
  /** Runs an instant runtime action (state/weight) with busy + guardrail confirm. */
  runtimeAction: (key: string, run: (force: boolean) => Promise<unknown>) => Promise<void>;
  busy: Record<string, boolean>;
};
