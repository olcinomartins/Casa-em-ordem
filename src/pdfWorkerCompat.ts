import "./polyfills";

// Mantém a avaliação do PDF.js suspensa até que o polyfill esteja disponível
// também dentro do contexto isolado do Web Worker no Safari/iOS.
await import("pdfjs-dist/build/pdf.worker.min.mjs");

export {};
