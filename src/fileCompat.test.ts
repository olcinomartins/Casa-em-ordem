import { describe, expect, it, vi } from "vitest";
import { readBlobArrayBuffer } from "./fileCompat";

describe("leitura compatível de arquivos", () => {
  it("usa arrayBuffer quando o navegador oferece a função", async () => {
    const expected = new Uint8Array([1, 2, 3]).buffer;
    const arrayBuffer = vi.fn().mockResolvedValue(expected);
    await expect(readBlobArrayBuffer({ arrayBuffer } as unknown as Blob)).resolves.toBe(expected);
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});
