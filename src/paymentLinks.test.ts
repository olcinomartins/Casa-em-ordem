import { describe, expect, it } from "vitest";
import { normalizePaymentUrl } from "./paymentLinks";

describe("normalizePaymentUrl", () => {
  it("mantém endereços web completos", () => {
    expect(normalizePaymentUrl(" https://conta.exemplo.com/pagar ")).toBe(
      "https://conta.exemplo.com/pagar",
    );
  });

  it("completa endereços sem protocolo com https", () => {
    expect(normalizePaymentUrl("conta.exemplo.com/pagar")).toBe(
      "https://conta.exemplo.com/pagar",
    );
  });

  it("preserva links profundos de aplicativos", () => {
    expect(normalizePaymentUrl("bancoexemplo://pagamentos/123")).toBe(
      "bancoexemplo://pagamentos/123",
    );
  });

  it("retorna vazio quando nenhum link foi informado", () => {
    expect(normalizePaymentUrl("   ")).toBeUndefined();
  });

  it("rejeita protocolos inseguros", () => {
    expect(() => normalizePaymentUrl("javascript:alert(1)")).toThrow(
      "Link de pagamento inválido",
    );
  });
});
