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
        authority: "https://login.microsoftonline.com/consumers",
        redirectUri,
      },
      // O estado transitório da autenticação fica limitado à aba. Isso evita que
      // um popup interrompido no celular bloqueie sessões futuras.
      cache: { cacheLocation: "sessionStorage" },
    })
  : null;
let etag: string | undefined;
const scopes = ["Files.ReadWrite", "User.Read"];
const ownPath = "/me/drive/root:/CasaEmOrdem-familia.json:/content";
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
  if (location)
    localStorage.setItem("casa-em-ordem-cloud", JSON.stringify(location));
  else localStorage.removeItem("casa-em-ordem-cloud");
};
const contentPath = () => {
  const x = getCloudLocation();
  return x
    ? `/drives/${encodeURIComponent(x.driveId)}/items/${encodeURIComponent(x.itemId)}/content`
    : ownPath;
};
let initialization: Promise<void> | undefined;
let redirectHandling: Promise<unknown> | undefined;
let tokenInFlight: Promise<string> | undefined;

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
    await msal!.loginRedirect({ scopes, redirectStartPage: location.href });
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
export async function signIn(): Promise<AccountInfo> {
  await prepareAuth();
  const account = msal!.getAllAccounts()[0];
  if (account) return account;
  await msal!.loginRedirect({ scopes, redirectStartPage: location.href });
  throw new Error("Redirecionando para a Microsoft…");
}
export function isConfigured() {
  return Boolean(msal);
}
export async function loadCloud(): Promise<FamilyData | null> {
  const t = await token();
  const r = await fetch(`https://graph.microsoft.com/v1.0${contentPath()}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`OneDrive: ${r.status}`);
  etag = r.headers.get("ETag") ?? undefined;
  return r.json();
}
export async function saveCloud(data: FamilyData) {
  const t = await token();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
  };
  if (etag) headers["If-Match"] = etag;
  const r = await fetch(`https://graph.microsoft.com/v1.0${contentPath()}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (r.status === 412)
    throw new Error(
      "A base foi alterada em outro dispositivo. Recarregue antes de salvar.",
    );
  if (!r.ok) throw new Error(`Falha ao salvar no OneDrive (${r.status}).`);
  etag = r.headers.get("ETag") ?? undefined;
  const item = await r.json();
  if (!getCloudLocation() && item.id && item.parentReference?.driveId)
    setCloudLocation({
      driveId: item.parentReference.driveId,
      itemId: item.id,
    });
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
