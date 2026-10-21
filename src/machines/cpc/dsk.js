/* .DSK floppy disk images (CPCEMU) — standard and extended formats.

   Disk = { sides, tracks: [side][track] = Track | null, creator, dirty, name? }
   Track = { track, side, gap3, filler, sectors: [{ C, H, R, N, st1, st2, data }] }

   Standard format: 'MV - CPCEMU Disk-File\r\nDisk-Info\r\n', common track size
   (header included) at 0x32–0x33, sectors of 128 << N bytes (N of the track).
   Extended format: 'EXTENDED CPC DSK File\r\nDisk-Info\r\n', table of track sizes
   (in units of 256 bytes) at 0x34, actual size of each sector in the
   track header; a zero size means a missing track.
   Tracks are stored track 0 side 0, track 0 side 1, track 1 side 0… */

const SIG_STD = 'MV - CPC';
const SIG_EXT = 'EXTENDED';
const HEADER_EXT = 'EXTENDED CPC DSK File\r\nDisk-Info\r\n';
const TRACK_INFO = 'Track-Info\r\n';
const CREATOR = 'Z80 Studio';

const ascii = (b, start, len) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const putAscii = (b, start, s, max = s.length) => {
  for (let i = 0; i < Math.min(s.length, max); i++) b[start + i] = s.charCodeAt(i) & 0xFF;
};

// Track header size: 256 bytes, more beyond 29 sectors
const trackHeaderSize = count => Math.max(0x100, Math.ceil((0x18 + 8 * count) / 0x100) * 0x100);

export function parseDSK(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 0x100) throw new Error(`Invalid DSK file: ${b.length} bytes, the header requires 256`);
  const sig = ascii(b, 0, 8);
  const extended = sig === SIG_EXT;
  if (!extended && sig !== SIG_STD) throw new Error("Invalid DSK file: missing 'MV - CPCEMU' or 'EXTENDED CPC DSK' signature");

  const creator = ascii(b, 0x22, 14).replace(/[\0 ]+$/, '');
  const nTracks = b[0x30], sides = b[0x31];
  if (sides < 1 || sides > 2) throw new Error(`Invalid DSK file: ${sides} sides declared`);
  if (extended && nTracks * sides > 0x100 - 0x34) throw new Error(`Invalid DSK file: ${nTracks} tracks, too many for the size table`);
  const stdSize = b[0x32] | (b[0x33] << 8);
  if (!extended && nTracks > 0 && stdSize < 0x100) throw new Error(`Invalid DSK file: track size ${stdSize}`);

  const tracks = [];
  for (let s = 0; s < sides; s++) tracks.push([]);
  let off = 0x100;
  for (let t = 0; t < nTracks; t++) {
    for (let s = 0; s < sides; s++) {
      const size = extended ? b[0x34 + t * sides + s] * 0x100 : stdSize;
      if (size === 0) { tracks[s].push(null); continue; }
      if (off + size > b.length) throw new Error(`Truncated DSK file: track ${t} side ${s} incomplete`);
      tracks[s].push(parseTrack(b, off, size, extended, t, s));
      off += size;
    }
  }
  return { sides, tracks, creator, dirty: false };
}

function parseTrack(b, off, size, extended, t, s) {
  if (ascii(b, off, 10) !== 'Track-Info') throw new Error(`Invalid DSK file: missing 'Track-Info' header for track ${t} side ${s}`);
  const trackN = b[off + 0x14], count = b[off + 0x15];
  const end = off + size;
  let ptr = off + trackHeaderSize(count);
  if (off + 0x18 + 8 * count > end) throw new Error(`Invalid DSK file: sector table of track ${t} side ${s} outside the track`);
  const sectors = [];
  for (let k = 0; k < count; k++) {
    const i = off + 0x18 + 8 * k;
    const len = extended ? b[i + 6] | (b[i + 7] << 8) : Math.min(0x80 << Math.min(trackN, 8), 0x1800);
    if (ptr + len > end) throw new Error(`Invalid DSK file: sector ${k} of track ${t} side ${s} outside the track`);
    sectors.push({ C: b[i], H: b[i + 1], R: b[i + 2], N: b[i + 3], st1: b[i + 4], st2: b[i + 5], data: b.slice(ptr, ptr + len) });
    ptr += len;
  }
  return { track: b[off + 0x10], side: b[off + 0x11], gap3: b[off + 0x16], filler: b[off + 0x17], sectors };
}

export function writeDSK(disk) {
  const sides = disk.sides;
  if (sides < 1 || sides > 2) throw new Error(`Invalid disk: ${sides} sides`);
  let nTracks = 0;
  for (let s = 0; s < sides; s++) nTracks = Math.max(nTracks, (disk.tracks[s] || []).length);
  if (nTracks * sides > 0x100 - 0x34) throw new Error(`Invalid disk: ${nTracks} tracks, too many for the extended format`);

  // Size of each track block, rounded up to 256 bytes
  const blocks = [];
  for (let t = 0; t < nTracks; t++) {
    for (let s = 0; s < sides; s++) {
      const trk = (disk.tracks[s] || [])[t] || null;
      if (!trk) { blocks.push({ trk: null, size: 0, t, s }); continue; }
      let size = trackHeaderSize(trk.sectors.length);
      for (const sec of trk.sectors) size += sec.data.length;
      size = Math.ceil(size / 0x100) * 0x100;
      if (size > 0xFF00) throw new Error(`Invalid disk: track ${t} side ${s} too large (${size} bytes)`);
      blocks.push({ trk, size, t, s });
    }
  }

  const total = 0x100 + blocks.reduce((n, x) => n + x.size, 0);
  const out = new Uint8Array(total);
  putAscii(out, 0, HEADER_EXT);
  putAscii(out, 0x22, disk.creator || CREATOR, 14);
  out[0x30] = nTracks;
  out[0x31] = sides;
  blocks.forEach((x, i) => { out[0x34 + i] = x.size >> 8; });

  let off = 0x100;
  for (const { trk, size, t, s } of blocks) {
    if (!trk) continue;
    putAscii(out, off, TRACK_INFO);
    out[off + 0x10] = t;
    out[off + 0x11] = s;
    out[off + 0x14] = trk.sectors.length ? trk.sectors[0].N : 2;
    out[off + 0x15] = trk.sectors.length;
    out[off + 0x16] = trk.gap3 ?? 0x52;
    out[off + 0x17] = trk.filler ?? 0xE5;
    let ptr = off + trackHeaderSize(trk.sectors.length);
    trk.sectors.forEach((sec, k) => {
      const i = off + 0x18 + 8 * k;
      out[i] = sec.C; out[i + 1] = sec.H; out[i + 2] = sec.R; out[i + 3] = sec.N;
      out[i + 4] = sec.st1 || 0; out[i + 5] = sec.st2 || 0;
      out[i + 6] = sec.data.length & 0xFF; out[i + 7] = sec.data.length >> 8;
      out.set(sec.data, ptr);
      ptr += sec.data.length;
    });
    off += size;
  }
  return out;
}

// Physical sector order with the interleave of 2 used by AMSDOS when formatting
const INTERLEAVE = [0, 5, 1, 6, 2, 7, 3, 8, 4];

export function blankDisk(format = 'data') {
  let first;
  if (format === 'data') first = 0xC1;
  else if (format === 'system') first = 0x41;
  else throw new Error(`Unknown disk format: '${format}' (expected 'data' or 'system')`);
  const side = [];
  for (let t = 0; t < 40; t++) {
    const sectors = INTERLEAVE.map(k => ({
      C: t, H: 0, R: first + k, N: 2, st1: 0, st2: 0, data: new Uint8Array(512).fill(0xE5),
    }));
    side.push({ track: t, side: 0, gap3: 0x52, filler: 0xE5, sectors });
  }
  return { sides: 1, tracks: [side], creator: CREATOR, dirty: false };
}
