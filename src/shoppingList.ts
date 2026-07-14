import { normalize } from "./domain";

export const shoppingMacroCategories = [
  "Proteínas",
  "Laticínios",
  "Mercearia",
  "Hortifruti",
  "Limpeza",
  "Higiene",
  "Pet",
  "Bebidas e lanches",
  "Outros",
] as const;

export const shoppingUnitOptions = [
  ["un", "Unidade"],
  ["kg", "Quilograma (kg)"],
  ["g", "Grama (g)"],
  ["l", "Litro (L)"],
  ["ml", "Mililitro (ml)"],
  ["pct", "Pacote"],
  ["cx", "Caixa"],
  ["dz", "Dúzia"],
  ["m", "Metro"],
  ["outro", "Outro"],
] as const;

export interface ShoppingItemDraft {
  name: string;
  quantity: number;
  unit: string;
  macroCategory: string;
  notes: string;
}

const numberWords: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
};

const units: Array<[RegExp, string]> = [
  [/^(?:quilogramas?|quilos?|kg)\b/i, "kg"],
  [/^(?:gramas?|g)\b/i, "g"],
  [/^(?:mililitros?|ml)\b/i, "ml"],
  [/^(?:litros?|l)\b/i, "l"],
  [/^(?:pacotes?|pct)\b/i, "pct"],
  [/^(?:caixas?|cx)\b/i, "cx"],
  [/^(?:d[uú]zias?|dz)\b/i, "dz"],
  [/^(?:metros?|m)\b/i, "m"],
  [/^(?:unidades?|itens?|un)\b/i, "un"],
];

export const inferShoppingMacro = (description: string) => {
  const n = normalize(description);
  if (/CARNE|FRANGO|PEIXE|LINGUICA|OVO/.test(n)) return "Proteínas";
  if (/LEITE|QUEIJO|IOGUR|MANTEIGA|REQUEI/.test(n)) return "Laticínios";
  if (/ARROZ|FEIJAO|MACARR|FARINHA|ACUCAR|CAFE|OLEO/.test(n))
    return "Mercearia";
  if (
    /BANANA|MACA|LARANJA|UVA|MAMAO|BATATA|TOMATE|CEBOLA|ALFACE|CENOURA/.test(
      n,
    )
  )
    return "Hortifruti";
  if (/SABAO|DETERG|DESINF|AMACIANTE|ESPONJA/.test(n)) return "Limpeza";
  if (/SHAMPOO|SABONETE|PAPEL HIG|CREME DENT/.test(n)) return "Higiene";
  if (/RACAO|PETISCO|CACHORR/.test(n)) return "Pet";
  if (/BISCOITO|CHOCOLATE|REFRIG|SUCO|CERVEJA/.test(n))
    return "Bebidas e lanches";
  return "Outros";
};

const readQuantity = (value: string) => {
  const numeric = value.match(/^(\d+(?:[.,]\d+)?)\b/);
  if (numeric)
    return {
      quantity: Number(numeric[1].replace(",", ".")),
      rest: value.slice(numeric[0].length).trim(),
    };
  const word = value.match(/^([\p{L}]+)\b/u);
  const quantity = word ? numberWords[normalize(word[1]).toLowerCase()] : undefined;
  return quantity
    ? { quantity, rest: value.slice(word![0].length).trim() }
    : { quantity: 1, rest: value };
};

export const parseShoppingSpeech = (transcript: string): ShoppingItemDraft => {
  let value = transcript.trim().replace(/[.!?]+$/g, "");
  value = value.replace(
    /^(?:adicione|adicionar|coloque|colocar|inclua|incluir|compre|comprar|quero(?:\s+comprar)?|preciso(?:\s+de)?|precisamos(?:\s+de)?)\s+/i,
    "",
  );

  let macroCategory = "";
  const categoryMatch = value.match(/\s+(?:na\s+)?categoria\s+(.+)$/i);
  if (categoryMatch) {
    const spokenCategory = normalize(categoryMatch[1]);
    macroCategory =
      shoppingMacroCategories.find(
        (category) => normalize(category) === spokenCategory,
      ) || "";
    value = value.slice(0, categoryMatch.index).replace(/[,;\s]+$/g, "").trim();
  }

  const quantityResult = readQuantity(value);
  let quantity = quantityResult.quantity;
  value = quantityResult.rest;
  let unit = "un";
  for (const [pattern, candidate] of units) {
    const match = value.match(pattern);
    if (!match) continue;
    unit = candidate;
    value = value.slice(match[0].length).trim();
    break;
  }
  value = value.replace(/^(?:de|do|da|dos|das)\s+/i, "").trim();

  // Também entende frases como “arroz 2 pacotes”.
  const trailing = value.match(
    /\s+(\d+(?:[.,]\d+)?)\s*(quilogramas?|quilos?|kg|gramas?|g|mililitros?|ml|litros?|l|pacotes?|pct|caixas?|cx|d[uú]zias?|dz|unidades?|itens?|un)$/i,
  );
  if (trailing) {
    quantity = Number(trailing[1].replace(",", "."));
    const spokenUnit = trailing[2];
    unit = units.find(([pattern]) => pattern.test(spokenUnit))?.[1] || unit;
    value = value.slice(0, trailing.index).trim();
  }

  value = value.replace(/[,;\s]+$/g, "").trim();
  const name = value || transcript.trim();
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unit,
    macroCategory: macroCategory || inferShoppingMacro(name),
    notes: "",
  };
};
