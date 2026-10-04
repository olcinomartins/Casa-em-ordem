const unsafeProtocols = new Set(["javascript:", "data:", "file:", "vbscript:"]);

export function normalizePaymentUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Link de pagamento inválido.");
  }
  if (unsafeProtocols.has(parsed.protocol.toLowerCase()))
    throw new Error("Link de pagamento inválido.");
  return candidate;
}
