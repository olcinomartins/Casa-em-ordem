/** Lê arquivos também em versões do WebKit que não implementam Blob.arrayBuffer. */
export function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("O navegador não devolveu os dados do arquivo."));
    };
    reader.readAsArrayBuffer(blob);
  });
}
