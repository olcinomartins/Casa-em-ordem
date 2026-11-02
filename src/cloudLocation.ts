/** File IDs locate the base; Microsoft Graph still requires a token and file permissions. */
export function configuredCloudLocation(env: {
  VITE_FAMILY_DRIVE_ID?: string;
  VITE_FAMILY_ITEM_ID?: string;
}) {
  const driveId = env.VITE_FAMILY_DRIVE_ID?.trim();
  const itemId = env.VITE_FAMILY_ITEM_ID?.trim();
  if (!driveId || !itemId) {
    throw new Error("Configure VITE_FAMILY_DRIVE_ID e VITE_FAMILY_ITEM_ID para acessar a base familiar autenticada.");
  }
  return { driveId, itemId };
}
