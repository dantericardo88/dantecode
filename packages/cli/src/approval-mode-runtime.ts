import {
  buildApprovalGatewayProfile,
  globalApprovalGateway,
  normalizeApprovalMode,
  type ApprovalModeInput,
  type CanonicalApprovalMode,
} from "@dantecode/core";

export { buildApprovalGatewayProfile, normalizeApprovalMode };
export type { ApprovalModeInput, CanonicalApprovalMode };

export function configureApprovalMode(mode: ApprovalModeInput): CanonicalApprovalMode {
  const normalized = normalizeApprovalMode(mode);
  if (!normalized) {
    throw new Error(`Unknown approval mode: ${mode}`);
  }

  globalApprovalGateway.configure(buildApprovalGatewayProfile(normalized));
  return normalized;
}
