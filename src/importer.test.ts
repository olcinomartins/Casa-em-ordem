import { describe, expect, it } from "vitest";
import { Transaction, audit } from "./domain";
import {
  hasImportedFactWithKey,
  identifyAccount,
  isInvoiceTransferDescription,
} from "./importer";
import { createSeed } from "./seed";

const transaction = (estimated: boolean): Transaction => ({
  ...audit("Olcino"),
  date: "2026-07-10",
  competence: "2026-07",
  purchaseDate: "2026-07-10",
  paymentDate: "2026-07-10",
  description: "Mercado Bom",
  normalized: "MERCADO BOM",
  amount: 50,
  accountId: "conta-teste",
  operator: "Olcino",
  scope: "Familiar",
  classification: "confirmed",
  dedupeKey: "mesma-chave",
  transfer: false,
  movement: "expense_income",
  sourceKind: "card",
  estimated,
});

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

describe("deduplicação da importação", () => {
  it("permite que o fato bancário entre quando só existe uma estimativa", () => {
    expect(
      hasImportedFactWithKey([transaction(true)], "mesma-chave"),
    ).toBe(false);
  });

  it("bloqueia uma segunda cópia de um fato já importado", () => {
    expect(
      hasImportedFactWithKey([transaction(false)], "mesma-chave"),
    ).toBe(true);
  });
});

describe("titularidade e responsabilidade na importação", () => {
  it("reconhece o titular sem transformar uma conta familiar em pessoal", () => {
    const data = createSeed();
    data.accounts = [
      {
        ...audit("Ambos"),
        name: "Inter, cartão 1234",
        institution: "Inter",
        kind: "card",
        holder: "Olcino",
        operator: "Ambos",
        active: true,
      },
      {
        ...audit("Mari"),
        name: "Inter, cartão 5678",
        institution: "Inter",
        kind: "card",
        holder: "Mari",
        operator: "Mari",
        active: true,
      },
    ];

    const identified = identifyAccount(
      data,
      "Inter",
      "card",
      "Fatura José Olcino Martins",
    );

    expect(identified?.account.name).toBe("Inter, cartão 1234");
    expect(identified?.account.holder).toBe("Olcino");
    expect(identified?.account.operator).toBe("Ambos");
  });
});
