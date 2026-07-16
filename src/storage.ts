import { openDB } from "idb";
import { FamilyData } from "./domain";
import { createSeed } from "./seed";

const dbp = openDB("casa-em-ordem", 1, {
  upgrade(db) {
    db.createObjectStore("data");
  },
});
const localPendingKey = "casa-em-ordem-local-pending";

export function markLocalPending(lastSavedAt: string) {
  try {
    localStorage.setItem(localPendingKey, lastSavedAt);
  } catch {
    // O próprio snapshot continua preservado no IndexedDB.
  }
}

export function hasLocalPending() {
  try {
    return Boolean(localStorage.getItem(localPendingKey));
  } catch {
    return false;
  }
}

export function clearLocalPending() {
  try {
    localStorage.removeItem(localPendingKey);
  } catch {
    // Sem armazenamento disponível, a comparação de conteúdo ainda protege.
  }
}

export async function loadLocal() {
  return (
    ((await (await dbp).get("data", "family")) as FamilyData | undefined) ??
    createSeed()
  );
}

export async function loadLocalIfPresent() {
  return (await (await dbp).get("data", "family")) as
    | FamilyData
    | undefined;
}

export async function loadLocalRecovery() {
  return (await (await dbp).get("data", "recovery")) as
    | FamilyData
    | undefined;
}

export async function saveLocalRecovery(data: FamilyData) {
  await (await dbp).put("data", structuredClone(data), "recovery");
}

export async function clearLocalRecovery() {
  await (await dbp).delete("data", "recovery");
}

export async function saveLocal(data: FamilyData) {
  // O carimbo representa uma alteração financeira, não a escrita do cache.
  // Ele é atualizado por `mutate`; salvar localmente não pode fazer uma cópia
  // antiga parecer mais nova que o OneDrive.
  await (await dbp).put("data", structuredClone(data), "family");
}

export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([content], { type }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function exportJson(data: FamilyData) {
  download(
    `casa-em-ordem-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 2),
  );
}

export async function restoreJson(file: File) {
  const parsed = JSON.parse(await file.text());
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.transactions))
    throw new Error("Backup incompatível.");
  return parsed as FamilyData;
}
