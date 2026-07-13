import { getMicrosoftAccessToken } from "./onedrive";

const endpoint = "https://casa-em-ordem-gemini.olcinofilho.workers.dev";

/**
 * Obtém as opções somente durante a sessão autenticada. Nada é persistido no
 * navegador, no OneDrive ou no repositório.
 */
export async function getProtectedPdfPasswords(): Promise<string[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getMicrosoftAccessToken()}`,
    },
    body: JSON.stringify({ action: "pdf-passwords" }),
  });
  if (!response.ok) return [];
  const result = await response.json().catch(() => ({}));
  if (!Array.isArray(result.passwords)) return [];
  const passwords: string[] = result.passwords.filter(
    (value: unknown): value is string => typeof value === "string" && Boolean(value),
  );
  return [...new Set<string>(passwords)];
}
