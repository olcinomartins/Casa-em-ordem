/// <reference types="vite/client" />
declare module 'virtual:pwa-register' { export function registerSW(options?: unknown): () => void }
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.js?url' {
  const workerUrl: string;
  export default workerUrl;
}
