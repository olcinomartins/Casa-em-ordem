import { describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
import { parseInterInvoiceItems } from "./interPdf";

describe("fatura PDF Inter", () => {
  it("lê parcelas e ignora a próxima fatura", () => {
    const rows = parseInterInvoiceItems([
      "Despesas da fatura", "CARTÃO 5364********1234", "13 de mar. 2026",
      "MOVIDA RAC LERJ (Parcela 03 de 12)", "-", "R$ 114,24",
      "18 de mai. 2026", "PAGAMENTO ON LINE", "-", "+ R$ 6.915,89",
      "Próxima fatura", "20 de jun. 2026", "NÃO IMPORTAR", "R$ 99,00",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({installment:3,installments:12,amount:114.24});
    expect(rows[1].amount).toBe(-6915.89);
  });
});
