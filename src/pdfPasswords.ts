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

export function isPdfPasswordError(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return name === "PasswordException" ||
    /senha do pdf.*(?:ausente|incorreta)|passwordexception|incorrect password|no password/i.test(message);
}

/**
 * Testa somente a próxima senha quando a tentativa anterior realmente falhou
 * por senha. Erros de worker, arquivo, parser ou conta devem chegar ao usuário
 * imediatamente, sem serem mascarados por uma tentativa posterior sem senha.
 */
export async function tryPdfPasswordCandidates<T>(
  candidates: Array<string | undefined>,
  attempt: (password?: string) => Promise<T>,
): Promise<T> {
  const unique = candidates.filter(
    (candidate, index) => candidates.indexOf(candidate) === index,
  );
  let passwordError: unknown;
  for (const password of unique) {
    try {
      return await attempt(password);
    } catch (error) {
      if (!isPdfPasswordError(error)) throw error;
      passwordError ??= error;
    }
  }
  throw passwordError ?? new Error("Nenhuma senha do PDF foi disponibilizada.");
}

export async function getProtectedPdfPasswords(bank: PdfBank): Promise<string[]> {
  const accessToken = await getMicrosoftAccessToken();
  // Nomes genéricos como "Fatura.pdf" não revelam o banco. Nesse caso o
  // Worker deriva, sem expor o CPF, as opções dos três formatos aceitos.
  const banks: Exclude<PdfBank, "unknown">[] =
    bank === "unknown" ? ["inter", "xp", "btg"] : [bank];
  const results = await Promise.allSettled(
    banks.map(async (candidate) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "pdf-passwords", bank: candidate }),
      });
      if (!response.ok) {
        throw new Error(
          `O cofre de senhas não respondeu corretamente (HTTP ${response.status}).`,
        );
      }
      const result = await response.json().catch(() => ({}));
      return Array.isArray(result.passwords)
        ? result.passwords.filter(
            (value: unknown): value is string =>
              typeof value === "string" && Boolean(value),
          )
        : [];
    }),
  );
  const passwords = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  const unique = [...new Set(passwords)];
  if (unique.length) return unique;
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  throw new Error(
    "Nenhuma senha automática foi encontrada. Confira os CPFs configurados nos Secrets do Worker.",
  );
}
