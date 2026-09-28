import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);

export type PurchaseUploadKind = "xlsx" | "csv" | "png" | "jpeg" | "webp";

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffPurchaseUpload(buffer: Buffer): PurchaseUploadKind | undefined {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return "xlsx";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature)) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (text.length && !text.includes("\0") && !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return "csv";
  } catch {
    // Invalid UTF-8 is not accepted as CSV.
  }
  return undefined;
}

export function validatePurchaseUploadType(fileName: string, mimeType: string, buffer: Buffer): PurchaseUploadKind {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/)?.[1];
  const extensionKinds: Record<string, PurchaseUploadKind> = {
    xlsx: "xlsx", csv: "csv", png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp",
  };
  const expected = extension ? extensionKinds[extension] : undefined;
  if (!expected) throw new Error("Solo se aceptan archivos .xlsx, .csv o imágenes PNG, JPG y WEBP.");
  const actual = sniffPurchaseUpload(buffer);
  if (!actual || actual !== expected) throw new Error("La extensión del archivo no coincide con su contenido real.");
  const allowedMime: Record<PurchaseUploadKind, Set<string>> = {
    xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
    csv: new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]),
    png: new Set(["image/png"]),
    jpeg: new Set(["image/jpeg"]),
    webp: new Set(["image/webp"]),
  };
  if (mimeType && mimeType !== "application/octet-stream" && !allowedMime[actual].has(mimeType)) {
    throw new Error("El tipo declarado del archivo no coincide con su contenido real.");
  }
  return actual;
}

export function parseCsvRows(buffer: Buffer): unknown[][] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  if (text.length > 10 * 1024 * 1024 || text.includes("\0") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error("El CSV contiene datos binarios o caracteres no permitidos.");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiterCounts = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let headerQuoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    if (firstLine[index] === '"') {
      if (headerQuoted && firstLine[index + 1] === '"') index += 1;
      else headerQuoted = !headerQuoted;
    } else if (!headerQuoted && delimiterCounts.has(firstLine[index])) {
      delimiterCounts.set(firstLine[index], delimiterCounts.get(firstLine[index])! + 1);
    }
  }
  const delimiter = [...delimiterCounts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ",";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(cell); cell = "";
      if (row.length > 50) throw new Error("El archivo supera el límite de 50 columnas.");
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = "";
      if (rows.length > 2_000) throw new Error("El archivo supera el límite de 2.000 filas.");
    } else cell += char;
  }
  if (quoted) throw new Error("El CSV contiene una celda entrecomillada incompleta.");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  if (rows.length > 2_000) throw new Error("El archivo supera el límite de 2.000 filas.");
  if (rows.some((value) => value.length > 50)) throw new Error("El archivo supera el límite de 50 columnas.");
  return rows;
}

export async function parseXlsxIsolated(buffer: Buffer): Promise<unknown[][]> {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      try {
        const ExcelJS = require(workerData.modulePath);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(workerData.data));
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("El archivo no contiene una hoja.");
        if (sheet.rowCount > 2000) throw new Error("La hoja supera el límite de 2.000 filas.");
        if (sheet.columnCount > 50) throw new Error("La hoja supera el límite de 50 columnas.");
        const value = (cell) => {
          const v = cell.value;
          if (v == null) return "";
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
          if (v instanceof Date) return v.toISOString();
          if (typeof v === "object" && "result" in v) return String(v.result ?? "");
          if (typeof v === "object" && "text" in v) return String(v.text ?? "");
          return String(v);
        };
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (row) => {
          if (rows.length >= 2000) throw new Error("La hoja supera el límite de 2.000 filas.");
          const cells = [];
          for (let column = 1; column <= Math.min(row.cellCount, 50); column++) cells.push(value(row.getCell(column)));
          rows.push(cells);
        });
        const serialized = JSON.stringify(rows);
        if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error("Los datos extraídos del Excel son demasiado grandes.");
        parentPort.postMessage({ result: rows });
      } catch (error) {
        parentPort.postMessage({ error: error instanceof Error ? error.message : "No se pudo leer el Excel." });
      }
    })();
  `;
  const worker = new Worker(source, {
    eval: true,
    workerData: {
      modulePath: require.resolve("exceljs"),
      data: Uint8Array.from(buffer),
    },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<unknown[][]>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };
      timer = setTimeout(() => finish(() => reject(new Error("La lectura del Excel tardó demasiado."))), 15_000);
      worker.once("message", (message: { result?: unknown[][]; error?: string }) => finish(() => {
        if (message.error) reject(new Error(message.error));
        else resolve(message.result ?? []);
      }));
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", (code) => {
        if (code !== 0) finish(() => reject(new Error("El analizador de Excel terminó inesperadamente.")));
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

function jpegDimensions(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error("La cabecera JPEG no es válida.");
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error("La cabecera JPEG está truncada.");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error("No se encontraron dimensiones JPEG válidas.");
}

export function imageDimensions(buffer: Buffer, kind: "png" | "jpeg" | "webp") {
  if (kind === "png") {
    if (buffer.length < 33 || buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("La cabecera PNG no es válida.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (kind === "jpeg") return jpegDimensions(buffer);
  if (buffer.length < 30) throw new Error("La cabecera WEBP está truncada.");
  const riffSize = buffer.readUInt32LE(4);
  if (riffSize < 22 || riffSize + 8 > buffer.length) throw new Error("El contenedor WEBP no es válido.");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") return {
    width: 1 + buffer.readUIntLE(24, 3),
    height: 1 + buffer.readUIntLE(27, 3),
  };
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) throw new Error("La cabecera WEBP lossless no es válida.");
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) throw new Error("La cabecera WEBP no es válida.");
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  throw new Error("El formato interno WEBP no es compatible.");
}

export function validateImagePixels(buffer: Buffer, kind: "png" | "jpeg" | "webp") {
  const { width, height } = imageDimensions(buffer, kind);
  if (!width || !height) throw new Error("No se pudieron comprobar las dimensiones de la imagen.");
  if (width * height > 24_000_000) throw new Error("La imagen supera el límite de 24 megapíxeles.");
}

export function validateProductImageContent(buffer: Buffer, contentType: string) {
  const kind = sniffPurchaseUpload(buffer);
  const expectedKind = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/webp": "webp",
  }[contentType];
  if (!expectedKind || kind !== expectedKind) {
    throw new Error("El contenido real de la foto no coincide con su tipo.");
  }
  validateImagePixels(buffer, kind as "png" | "jpeg" | "webp");
  return kind;
}