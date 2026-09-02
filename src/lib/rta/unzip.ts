/**
 * AES-zip extraction for RTA mailback files (server-only).
 *
 * Kfintech/CAMS ship their daily feeds as WinZip-AES password-protected zips —
 * a format Node's stdlib and most zip libs can't read. `@zip.js/zip.js` is a
 * pure-JS reader with AES support, so we can accept the zip directly and the
 * user just supplies the password (never persisted) at upload time.
 */

import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from "@zip.js/zip.js";

// No Web Workers in the Node server runtime — decode inline.
configure({ useWebWorkers: false });

// zip.js types Entry as a File|Directory union; only file entries expose getData.
type FileEntry = {
  filename: string;
  directory: boolean;
  getData?: (writer: unknown, options?: unknown) => Promise<Uint8Array>;
};

export async function extractRtaFileFromZip(
  buf: Uint8Array,
  password?: string
): Promise<{ filename: string; data: Uint8Array }> {
  const reader = new ZipReader(new Uint8ArrayReader(buf), password ? { password } : undefined);
  try {
    const entries = (await reader.getEntries()) as unknown as FileEntry[];
    const entry =
      entries.find((e) => !e.directory && /\.(csv|txt|xls[xmb]?)$/i.test(e.filename)) ??
      entries.find((e) => !e.directory);
    if (!entry || typeof entry.getData !== "function") {
      throw new Error("the archive contains no readable data file");
    }
    // Return raw bytes — the caller decodes CSV as text or reads .xls as binary.
    let data: Uint8Array;
    try {
      data = (await entry.getData(new Uint8ArrayWriter(), password ? { password } : undefined)) as Uint8Array;
    } catch (err) {
      // Resilience: if a password was supplied but this entry isn't actually
      // encrypted (or vice-versa), retry the other way before giving up.
      try {
        data = (await entry.getData(new Uint8ArrayWriter(), password ? undefined : undefined)) as Uint8Array;
      } catch {
        throw err;
      }
    }
    return { filename: entry.filename, data };
  } finally {
    await reader.close();
  }
}
