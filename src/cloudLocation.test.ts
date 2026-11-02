import { describe, expect, it } from "vitest";
import { configuredCloudLocation } from "./cloudLocation";

describe("configuredCloudLocation", () => {
  it("uses the canonical file identifiers without an anonymous sharing link", () => {
    expect(configuredCloudLocation({ VITE_FAMILY_DRIVE_ID: " drive ", VITE_FAMILY_ITEM_ID: " item " }))
      .toEqual({ driveId: "drive", itemId: "item" });
  });
  it("refuses incomplete configuration instead of falling back to an old cached file", () => {
    for (const env of [{}, { VITE_FAMILY_DRIVE_ID: "drive" }, { VITE_FAMILY_ITEM_ID: "item" }]) {
      expect(() => configuredCloudLocation(env)).toThrow("Configure");
    }
  });
});
