import { describe, expect, it } from "vitest";
import { isInvoiceTransferDescription } from "./importer";

describe("identificação de pagamentos de fatura", () => {
  it("reconhece os textos reais dos bancos", () => {
    expect(isInvoiceTransferDescription("Pagamento de fatura")).toBe(true);
    expect(isInvoiceTransferDescription("P AGAMENTO ON LINE")).toBe(true);
    expect(isInvoiceTransferDescription("PAGAMENTOS VALIDOS NORMAIS")).toBe(true);
  });

  it("não confunde estorno com pagamento da fatura", () => {
    expect(isInvoiceTransferDescription("Estorno de compra no cartão")).toBe(false);
    expect(isInvoiceTransferDescription("Crédito por cancelamento da loja")).toBe(false);
  });
});
