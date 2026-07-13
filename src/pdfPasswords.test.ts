import { describe, expect, it, vi } from "vitest";

vi.mock("./onedrive", () => ({
  getMicrosoftAccessToken: vi.fn(),
}));

import { getMicrosoftAccessToken } from "./onedrive";
import {
  getProtectedPdfPasswords,
  isPdfPasswordError,
  tryPdfPasswordCandidates,
} from "./pdfPasswords";

describe("tentativas de senha de PDF", () => {
  it("tenta a próxima opção depois de um erro real de senha", async () => {
    const attempt = vi.fn(async (password?: string) => {
      if (password === "errada") {
        throw new Error("A senha do PDF está ausente ou incorreta.");
      }
      return "importado";
    });

    await expect(
      tryPdfPasswordCandidates(["errada", "correta", undefined], attempt),
    ).resolves.toBe("importado");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("não mascara erro do leitor tentando outra senha", async () => {
    const readerError = new Error("O navegador não conseguiu iniciar o leitor de PDF.");
    const attempt = vi.fn(async (password?: string) => {
      if (password === "errada") {
        throw new Error("A senha do PDF está ausente ou incorreta.");
      }
      throw readerError;
    });

    await expect(
      tryPdfPasswordCandidates(["errada", "correta", undefined], attempt),
    ).rejects.toBe(readerError);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("reconhece PasswordException mesmo antes da tradução", () => {
    const error = Object.assign(new Error("No password given"), {
      name: "PasswordException",
    });
    expect(isPdfPasswordError(error)).toBe(true);
    expect(isPdfPasswordError(new Error("Falha ao iniciar o worker"))).toBe(false);
  });

  it("não transforma erro HTTP do cofre em senha incorreta", async () => {
    vi.mocked(getMicrosoftAccessToken).mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

    await expect(getProtectedPdfPasswords("inter")).rejects.toThrow("HTTP 503");
    vi.unstubAllGlobals();
  });

  it("explica quando os Secrets não geraram nenhuma senha", async () => {
    vi.mocked(getMicrosoftAccessToken).mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ passwords: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(getProtectedPdfPasswords("xp")).rejects.toThrow(
      "Nenhuma senha automática foi encontrada",
    );
    vi.unstubAllGlobals();
  });
});
