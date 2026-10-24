import QRCode from "qrcode";

/** PNG data URL, for an <img src=...> on the route sheet / delivery board. */
export async function qrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

/** Inline SVG markup, for the printable route sheet (sharper at print DPI than a raster PNG). */
export async function qrCodeSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
