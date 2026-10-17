/** HWP 0x00BBGGRR → HTML #rrggbb. The color picker uses only the low 24 bits. */
export function colorRefToHex(colorRef: number): string {
  const r = colorRef & 0xFF;
  const g = (colorRef >> 8) & 0xFF;
  const b = (colorRef >> 16) & 0xFF;
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** HTML #rrggbb → HWP 0x00BBGGRR. */
export function hexToColorRef(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return (b << 16) | (g << 8) | r;
}
