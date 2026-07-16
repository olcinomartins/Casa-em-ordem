import { PublicClientApplication, AccountInfo } from "@azure/msal-browser";
import { FamilyData } from "./domain";
const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;
const redirectUri =
  (import.meta.env.VITE_MS_REDIRECT_URI as string | undefined) ||
  location.href.split("#")[0];
const msal = clientId
  ? new PublicClientApplication({
      auth: {
        clientId,
        authority: "https://login.microsoftonline.com/common",
        redirectUri,
      },
      // O estado transitório da autenticação fica limitado à aba. Isso evita que
      // um popup interrompido no celular bloqueie sessões futuras.
      cache: { cacheLocation: "localStorage", cacheRetentionDays: 0 },
    })
  : null;
let etag: string | undefined;
let knownMissing = false;
const scopes = ["Files.ReadWrite", "User.Read"];
const ownPath = "/me/drive/root:/Casa em ordem/CasaEmOrdem-familia.json:/content";
const familyShareUrl = "https://1drv.ms/u/c/f55991dc870e2ff6/IQDzSgFJjs81SZM-o0Azn3oDAVCzNszRi85T6rrUrVVjMzs?e=QUS2Jl";
export interface CloudLocation {
  driveId: string;
  itemId: string;
}
export const getCloudLocation = (): CloudLocation | undefined => {
  try {
    return (
      JSON.parse(localStorage.getItem("casa-em-ordem-cloud") || "null") ||
      undefined
    );
  } catch {
    return undefined;
  }
};
export const setCloudLocation = (location?: CloudLocation) => {
  const previous = getCloudLocation();
  const changed =
    previous?.driveId !== location?.driveId ||
    previous?.itemId !== location?.itemId;
  if (location)
    localStorage.setItem("casa-em-ordem-cloud", JSON.stringify(location));
  else localStorage.removeItem("casa-em-ordem-cloud");
  if (changed) {
    etag = undefined;
    knownMissing = false;
  }
};
export const hasCloudVersion = () => Boolean(etag || knownMissing);
const cloudLocationKey = (location = getCloudLocation()) =>
  location ? `${location.driveId}\u0000${location.itemId}` : "__own_drive__";
const contentPathFor = (location = getCloudLocation()) => {
  const x = location;
  return x
    ? `/drives/${encodeURIComponent(x.driveId)}/items/${encodeURIComponent(x.itemId)}/content`
    : ownPath;
};
const contentPath = () => contentPathFor();
const metadataPath = () => contentPath().replace(/\/content$/, "");

async function readCloudVersion(accessToken: string) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0${metadataPath()}?$select=id,eTag,parentReference`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404)
    return { missing: true, etag: undefined as string | undefined };
  if (!response.ok)
    throw new Error(`Não foi possível confirmar a versão no OneDrive (${response.status}).`);
  const item = await response.json();
  return {
    missing: false,
    etag:
      response.headers.get("ETag") ||
      (typeof item.eTag === "string" ? item.eTag : undefined),
  };
}
let initialization: Promise<void> | undefined;
let redirectHandling: Promise<unknown> | undefined;
let tokenInFlight: Promise<string> | undefined;
let writeGeneration = 0;
let writesInFlight = 0;
let requestedSaveGeneration = 0;
let requestedReadGeneration = 0;
let adoptedReadGeneration = 0;
let pendingSnapshot:
  | {
      serializedData: string;
      generation: number;
      baseEtag?: string;
      baseKnownMissing: boolean;
      cloudPath: string;
      locationKey: string;
    }
  | undefined;
let drainingSaves = false;
let activeDrain: Promise<void> | undefined;
const saveWaiters: Array<{
  generation: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];

async function prepareAuth() {
  if (!msal) throw new Error("Configure VITE_MS_CLIENT_ID.");
  initialization ??= msal.initialize();
  await initialization;
  redirectHandling ??= msal.handleRedirectPromise();
  await redirectHandling;
}

export async function resumeSignIn(): Promise<AccountInfo | undefined> {
  await prepareAuth();
  return msal!.getAllAccounts()[0];
}

async function acquireToken() {
  await prepareAuth();
  let account = msal!.getAllAccounts()[0];
  if (!account) {
    await msal!.loginRedirect({
      scopes,
      redirectStartPage: location.href,
      prompt: "select_account",
    });
    throw new Error("Redirecionando para a Microsoft…");
  }
  try {
    return (await msal!.acquireTokenSilent({ scopes, account })).accessToken;
  } catch {
    await msal!.acquireTokenRedirect({ scopes, account });
    throw new Error("Renovando a autorização…");
  }
}

async function token() {
  // Salvar e conectar podem ser acionados quase juntos no celular. Todos os
  // chamadores compartilham a mesma interação em vez de abrir dois popups.
  tokenInFlight ??= acquireToken().finally(() => {
    tokenInFlight = undefined;
  });
  return tokenInFlight;
}
export async function getMicrosoftAccessToken() { return token(); }
export async function signIn(): Promise<AccountInfo> {
  await prepareAuth();
  const account = msal!.getAllAccounts()[0];
  if (account) return account;
  await msal!.loginRedirect({
    scopes,
    redirectStartPage: location.href,
    prompt: "select_account",
  });
  throw new Error("Redirecionando para a Microsoft…");
}
export function isConfigured() {
  return Boolean(msal);
}
export async function loadCloud(
  adoptVersion: boolean | (() => boolean) = true,
): Promise<FamilyData | null> {
  const shouldAdopt = () =>
    typeof adoptVersion === "function" ? adoptVersion() : adoptVersion;
  const readGeneration = ++requestedReadGeneration;
  const generationAtStart = writeGeneration;
  const t = await token();
  let r = await fetch(`https://graph.microsoft.com/v1.0${contentPath()}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (r.status === 404 && !getCloudLocation()) {
    const encoded = btoa(familyShareUrl).replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
    const meta = await fetch(`https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`, {headers:{Authorization:`Bearer ${t}`}});
    if (meta.ok) {
      const item = await meta.json();
      const driveId = item.parentReference?.driveId;
      if (driveId && item.id) {
        setCloudLocation({driveId,itemId:item.id});
        r = await fetch(`https://graph.microsoft.com/v1.0${contentPath()}`, {headers:{Authorization:`Bearer ${t}`}});
      }
    }
  }
  if (r.status === 404) {
    if (
      shouldAdopt() &&
      readGeneration >= adoptedReadGeneration &&
      writesInFlight === 0 &&
      generationAtStart === writeGeneration
    ) {
      etag = undefined;
      knownMissing = true;
      adoptedReadGeneration = readGeneration;
    }
    return null;
  }
  if (!r.ok) throw new Error(`OneDrive: ${r.status}`);
  let loadedEtag = r.headers.get("ETag") ?? undefined;
  if (
    shouldAdopt() &&
    readGeneration >= adoptedReadGeneration &&
    !loadedEtag &&
    writesInFlight === 0 &&
    generationAtStart === writeGeneration
  ) {
    const version = await readCloudVersion(t);
    if (!version.etag)
      throw new Error(
        "O OneDrive não informou a versão da base. A leitura foi interrompida para evitar sobrescrita.",
      );
    const verified = await fetch(
      `https://graph.microsoft.com/v1.0${contentPath()}`,
      {
        headers: {
          Authorization: `Bearer ${t}`,
          "If-Match": version.etag,
        },
      },
    );
    if (!verified.ok)
      throw new Error(
        "A base mudou durante a leitura. Atualize novamente antes de editar.",
      );
    r = verified;
    loadedEtag = verified.headers.get("ETag") || version.etag;
  }
  // Uma leitura iniciada antes ou durante um PUT não pode substituir o eTag
  // mais recente devolvido por esse salvamento.
  if (
    shouldAdopt() &&
    readGeneration >= adoptedReadGeneration &&
    writesInFlight === 0 &&
    generationAtStart === writeGeneration
  ) {
    etag = loadedEtag;
    knownMissing = false;
    adoptedReadGeneration = readGeneration;
  }
  return r.json();
}
async function saveCloudNow(
  serializedData: string,
  baseEtag: string | undefined,
  baseKnownMissing: boolean,
  cloudPath: string,
  locationKey: string,
): Promise<string> {
  if (!baseEtag && !baseKnownMissing)
    throw new Error(
      "A versão-base do OneDrive não está disponível. Recarregue antes de salvar.",
    );
  const t = await token();
  writeGeneration += 1;
  writesInFlight += 1;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
  };
  if (baseEtag) headers["If-Match"] = baseEtag;
  else headers["If-None-Match"] = "*";
  try {
    const r = await fetch(`https://graph.microsoft.com/v1.0${cloudPath}`, {
      method: "PUT",
      headers,
      body: serializedData,
    });
    if (r.status === 412)
      throw new Error(
        "A base foi alterada em outro dispositivo. Recarregue antes de salvar.",
      );
    if (!r.ok) throw new Error(`Falha ao salvar no OneDrive (${r.status}).`);
    const item = await r.json();
    const savedEtag =
      r.headers.get("ETag") ||
      (typeof item.eTag === "string" ? item.eTag : undefined);
    if (!savedEtag)
      throw new Error(
        "O arquivo foi enviado, mas sua nova versão não pôde ser confirmada.",
      );
    // Uma gravação iniciada na base anterior pode terminar depois que o
    // usuário troca driveId/itemId. Nesse caso ela não pode reinstalar a
    // versão da localização antiga na localização nova.
    if (cloudLocationKey() === locationKey) {
      etag = savedEtag;
      knownMissing = false;
    }
    return savedEtag;
  } finally {
    writesInFlight -= 1;
    // Também invalida leituras iniciadas enquanto este PUT estava em curso.
    writeGeneration += 1;
  }
}

const settleWaiters = (generation: number, error?: unknown) => {
  for (let index = saveWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = saveWaiters[index];
    if (waiter.generation > generation) continue;
    saveWaiters.splice(index, 1);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }
};

async function drainSaveQueue() {
  if (drainingSaves) return;
  drainingSaves = true;
  try {
    while (pendingSnapshot) {
      // Chamadas feitas enquanto um PUT está em andamento substituem o
      // snapshot pendente. O estado intermediário não precisa ser enviado.
      const snapshot = pendingSnapshot;
      pendingSnapshot = undefined;
      try {
        const savedEtag = await saveCloudNow(
          snapshot.serializedData,
          snapshot.baseEtag,
          snapshot.baseKnownMissing,
          snapshot.cloudPath,
          snapshot.locationKey,
        );
        const nextSnapshot = pendingSnapshot as typeof snapshot | undefined;
        if (
          nextSnapshot &&
          nextSnapshot.locationKey === snapshot.locationKey &&
          nextSnapshot.baseEtag === snapshot.baseEtag &&
          nextSnapshot.baseKnownMissing === snapshot.baseKnownMissing
        ) {
          // O snapshot pendente contém este estado local mais alterações
          // posteriores; pode avançar para a versão criada por este PUT.
          nextSnapshot.baseEtag = savedEtag;
          nextSnapshot.baseKnownMissing = false;
        }
        settleWaiters(snapshot.generation);
      } catch (error) {
        settleWaiters(snapshot.generation, error);
      }
    }
  } finally {
    drainingSaves = false;
    // Uma chamada pode chegar entre o último teste do while e este finally.
  }
}

function startSaveDrain() {
  activeDrain ??= drainSaveQueue().finally(() => {
    activeDrain = undefined;
    if (pendingSnapshot) void startSaveDrain();
  });
  return activeDrain;
}

export async function waitForCloudIdle() {
  while (activeDrain) await activeDrain;
}

export function saveCloud(data: FamilyData): Promise<void> {
  const generation = ++requestedSaveGeneration;
  const location = getCloudLocation();
  pendingSnapshot = {
    serializedData: JSON.stringify(data),
    generation,
    baseEtag: etag,
    baseKnownMissing: knownMissing,
    cloudPath: contentPathFor(location),
    locationKey: cloudLocationKey(location),
  };
  const result = new Promise<void>((resolve, reject) => {
    saveWaiters.push({ generation, resolve, reject });
  });
  void startSaveDrain();
  return result;
}
export async function signOut() {
  if (msal) {
    await prepareAuth();
    const a = msal.getAllAccounts()[0];
    if (a)
      await msal.logoutRedirect({
        account: a,
        postLogoutRedirectUri: redirectUri,
      });
  }
}
