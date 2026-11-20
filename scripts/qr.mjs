import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [url, directory] = process.argv.slice(2);
if (
  !url ||
  new URL(url).protocol !== "https:" ||
  new URL(url).search ||
  new URL(url).hash ||
  !directory
)
  throw new Error(
    "Usage: npm run qr -- https://FINAL_HOST ABSOLUTE_OUTPUT_DIR (no tokens or parameters)",
  );
await mkdir(directory, { recursive: true });
const options = {
  errorCorrectionLevel: "M",
  margin: 4,
  width: 1000,
  color: { dark: "#173c29", light: "#ffffff" },
};
const path = resolve(directory, "qr-review.png");
await QRCode.toFile(path, url, options);
await writeFile(
  resolve(directory, "qr-review.svg"),
  await QRCode.toString(url, { ...options, type: "svg" }),
);
const png = PNG.sync.read(await readFile(path));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
if (decoded?.data !== url) throw new Error("QR decode verification failed");
await writeFile(
  resolve(directory, "qr-verification.json"),
  JSON.stringify(
    {
      url,
      decoded: decoded.data,
      verified: true,
      scope:
        "Library decoding only; camera scanning and anonymous public access must be checked separately",
    },
    null,
    2,
  ),
);
console.log("QR PNG and SVG generated and decoded:", url);
