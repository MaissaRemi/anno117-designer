/** Exporte un canvas en image PNG téléchargée. */
export function exportPng(canvas: HTMLCanvasElement, filename = "anno117-plan.png"): void {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
