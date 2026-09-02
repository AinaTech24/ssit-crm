// Reuse the same generated card for twitter:image as for og:image.
// `runtime` is declared locally (re-exporting a config field isn't statically
// analysable by Next), the rest is re-exported from the opengraph image.
export const runtime = "nodejs";
export { default, alt, size, contentType } from "./opengraph-image";
