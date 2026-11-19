import type { Instrumentation } from "next";

import { log } from "@/lib/log";

/** Every uncaught server error becomes one structured log line (with the digest the user sees). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as Error & { digest?: string };
  log.error("server.request_error", {
    digest: err.digest,
    error: err,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
