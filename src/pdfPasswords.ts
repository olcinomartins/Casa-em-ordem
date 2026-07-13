import { getMicrosoftAccessToken } from "./onedrive";

const endpoint = "https://casa-em-ordem-gemini.olcinofilho.workers.dev";

/**
 * Obtém as opções somente durante a sessão autenticada. Nada é persistido no
 * navegador, no OneDrive ou no repositório.
 */
export type PdfBank = "inter" | "xp" | "btg" | "unknown";

export function identifyPdfBank(filename: string): PdfBank {
  if (/inter/i.test(filename)) return "inter";
  if (/\bxp\b/i.test(filename.replace(/[_-]/g, " "))) return "xp";
  if (/btg/i.test(filename)) return "btg";
  return "unknown";
}

export async function getProtectedPdfPasswords(bank: PdfBank): Promise<string[]> {
  const accessToken = await getMicrosoftAccessToken();
  // Nomes genéricos como "Fatura.pdf" não revelam o banco. Nesse caso o
  // Worker deriva, sem expor o CPF, as opções dos três formatos aceitos.
  const banks: Exclude<PdfBank, "unknown">[] =
    bank === "unknown" ? ["inter", "xp", "btg"] : [bank];
  const results = await Promise.all(
    banks.map(async (candidate) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "pdf-passwords", bank: candidate }),
      });
      if (!response.ok) return [];
      const result = await response.json().catch(() => ({}));
      return Array.isArray(result.passwords)
        ? result.passwords.filter(
            (value: unknown): value is string =>
              typeof value === "string" && Boolean(value),
          )
        : [];
    }),
  );
  return [...new Set(results.flat())];
}
