import { describe, expect, it } from "vitest";
import { transactionDescriptionPatch } from "./transactionEditDraft";

describe("transactionDescriptionPatch", () => {
  it("prepara a descrição para salvar somente ao concluir a edição", () => {
    expect(transactionDescriptionPatch("Mercado", "Mercado Zona Sul")).toEqual({
      description: "Mercado Zona Sul",
      normalized: "MERCADO ZONA SUL",
    });
  });

  it("não solicita gravação quando o texto não mudou", () => {
    expect(transactionDescriptionPatch("Mercado", "Mercado")).toBeUndefined();
  });
});
