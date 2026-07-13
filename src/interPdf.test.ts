import { describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker", () => ({ default: class PdfWorker {} }));
import {
  findPdfDueDate,
  parseBtgInvoiceItems,
  parseInterInvoiceItems,
  parseXpInvoiceItems,
} from "./interPdf";

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

describe("faturas PDF de outros bancos", () => {
  it("lê vencimento do BTG quando a data vem junto do rótulo", () => {
    expect(findPdfDueDate(["Vencimento: 24/08"], 2025)).toBe("2025-08-24");
  });

  it("lê a sequência descrição, data e valor do BTG", () => {
    const rows = parseBtgInvoiceItems([
      "Pagamentos feitos pelo cliente",
      "Pagamento de fatura",
      "19 AGO",
      "-R$ 30,00",
      "Total de compras e despesas",
      "R$ 20,00",
      "LOJA UM PARC 2/3",
      "12 AGO",
      "R$ 10,00",
      "LOJA DOIS",
      "13 AGO",
      "R$ 30,00",
      "Taxas e encargos",
    ], 2025);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: "2025-08-19", description: "Pagamento de fatura", amount: -30 });
    expect(rows[1]).toMatchObject({ date: "2025-08-12", amount: 20, installment: 2, installments: 3 });
    expect(rows[2]).toMatchObject({ date: "2025-08-13", amount: 10 });
  });

  it("lê a tabela data, descrição e valor da XP", () => {
    const rows = parseXpInvoiceItems([
      "Vencimento", "20/05/2026", "Data", "Descrição", "R$", "US$",
      "02/05/26", "PAGAMENTOS VALIDOS NORMAIS", "-100,00", "Subtotal", "-100,00",
    ], 2026);
    expect(rows).toEqual([expect.objectContaining({
      date: "2026-05-02",
      description: "PAGAMENTOS VALIDOS NORMAIS",
      amount: -100,
    })]);
  });
});
