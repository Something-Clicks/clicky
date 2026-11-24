import { permanentRedirect } from "next/navigation";

/** The Diagnostic Audit was replaced by the Marketing Plan. Old links go to pricing. */
export default function DiagnosticAuditPage() {
  permanentRedirect("/pricing");
}
