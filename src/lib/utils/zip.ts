/**
 * Pure Node.js Store-mode ZIP compiler.
 * Computes correct CRC-32 values and formats the binary structure so the resulting
 * ZIP file is compatible with Windows Explorer, macOS Finder, and standard unzip utilities.
 */

// Precompute CRC-32 table
const crcTable = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

export function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

export interface ZipFileEntry {
  name: string;
  data: Buffer;
}

/**
 * Creates a Store-mode (no compression, method 0) ZIP archive.
 */
export function createZipArchive(entries: ZipFileEntry[]): Buffer {
  const buffers: Buffer[] = [];
  const localHeaders: { offset: number; crc: number; size: number; name: string }[] = [];
  let currentOffset = 0;

  // DOS time/date converter
  const date = new Date();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (LFH)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);          // Magic PK\x03\x04
    lfh.writeUInt16LE(10, 4);                  // Version needed (1.0)
    lfh.writeUInt16LE(0, 6);                   // General purpose bit flag
    lfh.writeUInt16LE(0, 8);                   // Compression method (0 = Store)
    lfh.writeUInt16LE(dosTime, 10);            // Last mod time
    lfh.writeUInt16LE(dosDate, 12);            // Last mod date
    lfh.writeUInt32LE(crc, 14);                // CRC-32
    lfh.writeUInt32LE(size, 18);               // Compressed size
    lfh.writeUInt32LE(size, 22);               // Uncompressed size
    lfh.writeUInt16LE(filenameBuf.length, 26); // Filename length
    lfh.writeUInt16LE(0, 28);                  // Extra field length

    localHeaders.push({ offset: currentOffset, crc, size, name: entry.name });

    buffers.push(lfh);
    buffers.push(filenameBuf);
    buffers.push(entry.data);

    currentOffset += lfh.length + filenameBuf.length + size;
  }

  const centralDirectoryOffset = currentOffset;
  let centralDirectorySize = 0;

  for (const entry of localHeaders) {
    const filenameBuf = Buffer.from(entry.name, 'utf-8');
    const cdfh = Buffer.alloc(46);
    cdfh.writeUInt32LE(0x02014b50, 0);          // Magic PK\x01\x02
    cdfh.writeUInt16LE(20, 4);                  // Version made by
    cdfh.writeUInt16LE(10, 6);                  // Version needed (1.0)
    cdfh.writeUInt16LE(0, 8);                   // General purpose bit flag
    cdfh.writeUInt16LE(0, 10);                  // Compression method (0 = Store)
    cdfh.writeUInt16LE(dosTime, 12);            // Last mod time
    cdfh.writeUInt16LE(dosDate, 14);            // Last mod date
    cdfh.writeUInt32LE(entry.crc, 16);          // CRC-32
    cdfh.writeUInt32LE(entry.size, 20);         // Compressed size
    cdfh.writeUInt32LE(entry.size, 24);         // Uncompressed size
    cdfh.writeUInt16LE(filenameBuf.length, 28); // Filename length
    cdfh.writeUInt16LE(0, 30);                  // Extra field length
    cdfh.writeUInt16LE(0, 32);                  // File comment length
    cdfh.writeUInt16LE(0, 34);                  // Disk number start
    cdfh.writeUInt16LE(0, 36);                  // Internal file attributes
    cdfh.writeUInt32LE(0, 38);                  // External file attributes
    cdfh.writeUInt32LE(entry.offset, 42);       // Relative offset of local header

    buffers.push(cdfh);
    buffers.push(filenameBuf);
    centralDirectorySize += cdfh.length + filenameBuf.length;
  }

  // End of central directory record (EOCD)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);              // Magic PK\x05\x06
  eocd.writeUInt16LE(0, 4);                       // Disk number
  eocd.writeUInt16LE(0, 6);                       // Disk with CD
  eocd.writeUInt16LE(localHeaders.length, 8);     // CD records on disk
  eocd.writeUInt16LE(localHeaders.length, 10);    // Total CD records
  eocd.writeUInt32LE(centralDirectorySize, 12);   // CD size
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20);                      // Comment length

  buffers.push(eocd);

  return Buffer.concat(buffers);
}
