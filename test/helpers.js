// Outils partagés par les tests.

/** Fabrique un petit fichier FIT : une session et une série de points (puissance, FC). */
export function makeFit(points, { sport = 2, start = 1000000000 } = {}) {
  const bytes = [];
  const u8 = (v) => bytes.push(v & 0xff);
  const u16 = (v) => { u8(v); u8(v >> 8); };
  const u32 = (v) => { u16(v & 0xffff); u16((v >>> 16) & 0xffff); };
  // Définition locale 0 : record (20) = ts (uint32), puissance (uint16), FC (uint8)
  u8(0x40); u8(0); u8(0); u16(20); u8(3);
  u8(253); u8(4); u8(0x86);
  u8(7); u8(2); u8(0x84);
  u8(3); u8(1); u8(0x02);
  points.forEach((p, i) => { u8(0x00); u32(start + i); u16(p.power); u8(p.hr ?? 0xff); });
  // Définition locale 1 : session (18) = ts, début, sport, temps (ms), distance (cm)
  u8(0x41); u8(0); u8(0); u16(18); u8(5);
  u8(253); u8(4); u8(0x86);
  u8(2); u8(4); u8(0x86);
  u8(5); u8(1); u8(0x00);
  u8(8); u8(4); u8(0x86);
  u8(9); u8(4); u8(0x86);
  u8(0x01); u32(start + points.length); u32(start); u8(sport); u32(points.length * 1000); u32(1234500);
  const header = [14, 0x20, 0, 0, bytes.length & 0xff, (bytes.length >> 8) & 0xff, (bytes.length >> 16) & 0xff, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...header, ...bytes, 0, 0]);
}
