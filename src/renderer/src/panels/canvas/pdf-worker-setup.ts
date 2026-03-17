import * as pdfjs from 'pdfjs-dist'

// Configure the pdfjs web worker. Vite's ?url import emits the worker
// as a static asset and returns its URL, working in both dev and prod.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export { pdfjs }
