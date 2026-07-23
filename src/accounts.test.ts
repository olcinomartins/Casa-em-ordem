import { describe, expect, it } from "vitest";
import type { Account } from "./domain";
import {
  accountHolder,
  accountKindLabel,
  accountOwnershipValue,
  accountResponsibilityLabel,
  inferInstitution,
  inferLastDigits,
  parseAccountOwnership,
} from "./accounts";

const account = (changes: Partial<Account> = {}): Account => ({
  id: "account-1",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  updatedBy: "Ambos",
  version: 1,
  name: "Inter, cartão 1234",
  institution: "Inter",
  kind: "card",
  holder: "Olcino",
  operator: "Ambos",
  active: true,
  ...changes,
});

describe("cadastro simplificado de contas", () => {
  it("separa titular legal do uso no planejamento", () => {
    expect(parseAccountOwnership("Mari:Ambos")).toEqual({
      holder: "Mari",
      operator: "Ambos",
    });
    expect(parseAccountOwnership("Olcino:Mari")).toEqual({
      holder: "Olcino",
      operator: "Mari",
    });
    expect(parseAccountOwnership("Ambos:Ambos")).toEqual({
      holder: "Ambos",
      operator: "Ambos",
    });
  });

  it("rejeita combinações não oferecidas pelo formulário", () => {
    expect(() => parseAccountOwnership("Ambos:Olcino")).toThrow(
      "Selecione a titularidade",
    );
  });

  it("deriva os dados técnicos do nome informado", () => {
    expect(inferInstitution("Inter, cartão final 9876")).toBe("Inter");
    expect(inferInstitution("Mercado Pago · conta 1234")).toBe(
      "Mercado Pago",
    );
    expect(inferLastDigits("XP, cartão 1234-5")).toBe("2345");
    expect(inferLastDigits("C6 Bank")).toBeUndefined();
  });

  it("mantém compatibilidade com contas pessoais antigas", () => {
    const legacy = account({ holder: undefined, operator: "Mari" });
    expect(accountHolder(legacy)).toBe("Mari");
    expect(accountOwnershipValue(legacy)).toBe("Mari:Mari");
  });

  it("não inventa titular para cadastro familiar antigo", () => {
    const legacy = account({ holder: undefined, operator: "Ambos" });
    expect(accountHolder(legacy)).toBeUndefined();
    expect(accountOwnershipValue(legacy)).toBe("");
    expect(accountResponsibilityLabel(legacy)).toBe(
      "Titular não definido · Uso: Família",
    );
  });

  it("exibe tipos e responsabilidade em linguagem amigável", () => {
    expect(accountKindLabel("checking")).toBe("Conta corrente");
    expect(accountKindLabel("card")).toBe("Cartão");
    expect(accountKindLabel("investment")).toBe("Investimento");
    expect(accountResponsibilityLabel(account())).toBe(
      "Titular: Olcino · Uso: Família",
    );
  });
});
