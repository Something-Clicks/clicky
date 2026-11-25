import { CAPABILITIES, unavailableReason, type CapabilityId } from "../capabilities";
import type { CapabilityModule } from "./types";

/**
 * Capabilities in the specification that are not built yet (or need a model provider or an
 * integration). They exist as modules so workflows can plan with them, and they always report
 * "blocked" with the reason. They never return placeholder output.
 */
export function notYetAvailable(id: CapabilityId, hasModelProvider: () => boolean): CapabilityModule<unknown, never> {
  return {
    id,
    async run() {
      const reason = unavailableReason(id, { modelProvider: hasModelProvider() }) ?? `${CAPABILITIES[id].label} is designed but not built yet.`;
      return { status: "blocked", reason };
    },
  };
}
