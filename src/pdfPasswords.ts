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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getMicrosoftAccessToken()}`,
    },
    body: JSON.stringify({ action: "pdf-passwords", bank }),
  });
  if (!response.ok) return [];
  const result = await response.json().catch(() => ({}));
  if (!Array.isArray(result.passwords)) return [];
  const passwords: string[] = result.passwords.filter(
    (value: unknown): value is string => typeof value === "string" && Boolean(value),
  );
  return [...new Set<string>(passwords)];
}
