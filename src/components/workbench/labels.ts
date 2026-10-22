// Plain words for actions and claim results on the workbench.
export const ACTION_LABEL: Record<string, string> = {
  ACCEPT_CLAIM: 'Accept the claim (refund)',
  PROVIDE_EVIDENCE: 'Send evidence',
  PROVIDE_SUPPORTING_INFO: 'Send supporting information',
  SEND_MESSAGE: 'Message the buyer',
  ESCALATE: 'Escalate to PayPal',
  WAIT: 'Wait',
  NO_ACTION: 'No action now',
};

export const RESULT_LABEL: Record<string, string> = {
  SUPPORTED: 'Supported',
  NEAR_MATCH: 'Near match',
  MISMATCH: 'Does not match the record',
  UNVERIFIED: 'Not verified',
};

export const EVIDENCE_LABEL: Record<string, string> = {
  PROOF_OF_FULFILLMENT: 'Proof of shipping',
  PROOF_OF_DELIVERY_SIGNATURE: 'Signed delivery',
  PROOF_OF_REFUND: 'Proof of refund',
};

export const humanise = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
