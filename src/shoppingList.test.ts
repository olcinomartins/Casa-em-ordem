import { describe, expect, it } from "vitest";
import { parseShoppingSpeech } from "./shoppingList";

describe("parseShoppingSpeech", () => {
  it("interpreta quantidade, unidade, produto e categoria falados", () => {
    expect(
      parseShoppingSpeech(
        "adicione dois pacotes de arroz, categoria mercearia",
      ),
    ).toMatchObject({
      name: "Arroz",
      quantity: 2,
      unit: "pct",
      macroCategory: "Mercearia",
    });
  });

  it("infere categoria e aceita quantidade decimal", () => {
    expect(parseShoppingSpeech("1,5 quilos de banana")).toMatchObject({
      name: "Banana",
      quantity: 1.5,
      unit: "kg",
      macroCategory: "Hortifruti",
    });
  });

  it("aceita quantidade e unidade depois do produto", () => {
    expect(parseShoppingSpeech("leite 2 litros")).toMatchObject({
      name: "Leite",
      quantity: 2,
      unit: "l",
      macroCategory: "Laticínios",
    });
  });

  it("entende comandos e unidades comuns na fala", () => {
    expect(parseShoppingSpeech("quero comprar 2 dúzias de ovos")).toMatchObject({
      name: "Ovos",
      quantity: 2,
      unit: "dz",
      macroCategory: "Proteínas",
    });
  });
});
