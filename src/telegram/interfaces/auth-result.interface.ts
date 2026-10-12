/** Outcome of one step of the multi-step auth flow. */
export interface AuthResult {
  sessionString?: string;
  needsCode?: boolean;
  needsPassword?: boolean;
  message: string;
}
