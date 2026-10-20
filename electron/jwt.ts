/** Decode a JWT payload without verifying it (we only read our own claims). */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** ChatGPT account id carried in Codex access tokens. */
export function codexAccountId(access: string): string | null {
  const auth = jwtClaims(access)?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
  const id = auth?.chatgpt_account_id;
  return typeof id === "string" ? id : null;
}
