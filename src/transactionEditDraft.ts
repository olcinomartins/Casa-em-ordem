import { normalize } from "./domain";

export function transactionDescriptionPatch(original: string, draft: string) {
  if (draft === original) return undefined;
  return {
    description: draft,
    normalized: normalize(draft),
  };
}
