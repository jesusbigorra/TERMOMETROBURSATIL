import { randomUUID } from "crypto";
import { createRequire } from "module";
import { Worker } from "worker_threads";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AnalyzePurchaseUploadBody,
  AnalyzePurchaseUploadResponse,
  ConfirmPurchaseImportBody,
  ConfirmPurchaseImportResponse,
  CreateProductBody,
  CreateProductResponse,
  CreateSaleBody,
  CreateSaleResponse,
  DeleteProductParams,
  GetInventoryActivityResponse,
  GetInventoryDashboardResponse,
  ListProductsResponse,
  ListPurchasesResponse,
  ListSalesResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import {
  db,
  inventoryActivityTable,
  purchaseItemsTable,
  purchasesTable,
  productsTable,
  saleItemsTable,
  salesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  completePurchasePreview,
  groupPurchaseItems,
  parsePurchaseRows,
  purchaseLineValues,
  rowsFromOcr,
} from "./inventory-purchase";
import {
  parseCsvRows,
  parseXlsxIsolated,
  validateImagePixels,
  validatePurchaseUploadType,
  type PurchaseUploadKind,
} from "./inventory-upload";

const router: IRouter = Router();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const uploadLimitBytes = 10 * 1024 * 1024;
const uploadAttempts = new Map<string, number[]>();
let ocrInProgress = false;
const require = createRequire(import.meta.url);

const productJson = (row: typeof productsTable.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

async function saleJson(row: typeof salesTable.$inferSelect) {
  const items = await db.select().from(saleItemsTable).where(eq(saleItemsTable.saleId, row.id));
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    items: items.map(({ saleId: _saleId, ...item }) => item),
  };
}

async function purchaseJson(row: typeof purchasesTable.$inferSelect) {
  const items = await db.select().from(purchaseItemsTable).where(eq(purchaseItemsTable.purchaseId, row.id));
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    items: items.map(({ purchaseId: _purchaseId, ...item }) => item),
  };
}

function validateZipComplexity(buffer: Buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return;
  let offset = 0;
  let entries = 0;
  let totalUncompressed = 0;
  while (offset + 46 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries += 1;
    totalUncompressed += uncompressed;
    if (entries > 1_000 || totalUncompressed > 30 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 150)) {
      throw new Error("El Excel es demasiado complejo o grande para analizarlo de forma segura.");
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  if (entries === 0) throw new Error("El archivo Excel no contiene un directorio ZIP válido.");
}

async function runIsolatedWorker<T>(
  source: string,
  workerData: object,
  timeoutMs: number,
  maxOldGenerationSizeMb: number,
  timeoutMessage: string,
): Promise<T> {
  const worker = new Worker(source, {
    eval: true,
    workerData,
    resourceLimits: { maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };
      timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), timeoutMs);
      worker.once("message", (message: { result?: T; error?: string }) => finish(() => {
        if (message.error) reject(new Error(message.error));
        else resolve(message.result as T);
      }));
      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", (code) => {
        if (code !== 0) finish(() => reject(new Error("El analizador aislado terminó inesperadamente.")));
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}

async function recognizePurchaseImage(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const source = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let worker;
      try {
        const { createWorker } = require(workerData.modulePath);
        worker = await createWorker("spa+eng");
        const result = await worker.recognize(Buffer.from(workerData.data));
        const text = String(result.data.text ?? "");
        if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("El texto extraído de la imagen es demasiado grande.");
        parentPort.postMessage({ result: { text, confidence: Number(result.data.confidence) || 0 } });
      } catch (error) {
        parentPort.postMessage({ error: error instanceof Error ? error.message : "No se pudo leer la imagen." });
      } finally {
        if (worker) await worker.terminate();
      }
    })();
  `;
  return runIsolatedWorker(source, {
    modulePath: require.resolve("tesseract.js"),
    data: Uint8Array.from(buffer),
  }, 45_000, 256, "La lectura tardó demasiado. Prueba con una foto más nítida o recortada.");
}

router.get("/inventory/products", async (_req, res): Promise<void> => {
  const rows = await db.select().from(productsTable).orderBy(asc(productsTable.name));
  res.json(ListProductsResponse.parse(rows.map(productJson)));
});

router.post("/inventory/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success || !Number.isInteger(parsed.data?.stock) || !Number.isInteger(parsed.data?.lowStockThreshold)) {
    res.status(400).json({ error: parsed.success ? "Las existencias deben ser números enteros." : parsed.error.message });
    return;
  }
  const id = randomUUID();
  try {
    const [row] = await db.transaction(async (tx) => {
      const created = await tx.insert(productsTable).values({ id, ...parsed.data, sku: parsed.data.sku.trim().toUpperCase(), name: parsed.data.name.trim(), category: parsed.data.category.trim() }).returning();
      await tx.insert(inventoryActivityTable).values({ id: randomUUID(), kind: "producto", title: "Producto añadido", detail: `${created[0].name} · ${created[0].stock} unidades` });
      return created;
    });
    res.status(201).json(CreateProductResponse.parse(productJson(row)));
  } catch (error) {
    req.log.warn({ err: error }, "Could not create inventory product");
    res.status(400).json({ error: "No se pudo guardar. Verifica que el SKU no esté repetido." });
  }
});

router.patch("/inventory/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const body = UpdateProductBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.stock !== undefined && !Number.isInteger(body.data.stock)) || (body.data.lowStockThreshold !== undefined && !Number.isInteger(body.data.lowStockThreshold))) {
    res.status(400).json({ error: "Datos del producto no válidos." });
    return;
  }
  const values = {
    ...body.data,
    ...(body.data.sku ? { sku: body.data.sku.trim().toUpperCase() } : {}),
    ...(body.data.name ? { name: body.data.name.trim() } : {}),
    ...(body.data.category ? { category: body.data.category.trim() } : {}),
  };
  const [row] = await db.update(productsTable).set(values).where(eq(productsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Producto no encontrado." });
    return;
  }
  await db.insert(inventoryActivityTable).values({ id: randomUUID(), kind: "ajuste", title: "Producto actualizado", detail: `${row.name} · existencia ${row.stock}` });
  res.json(UpdateProductResponse.parse(productJson(row)));
});

router.delete("/inventory/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Producto no válido." });
    return;
  }
  const [used] = await db.select({ id: saleItemsTable.id }).from(saleItemsTable).where(eq(saleItemsTable.productId, params.data.id)).limit(1);
  const [purchased] = await db.select({ id: purchaseItemsTable.id }).from(purchaseItemsTable).where(eq(purchaseItemsTable.productId, params.data.id)).limit(1);
  if (used || purchased) {
    res.status(409).json({ error: purchased ? "Este producto tiene movimientos y debe conservarse en el historial." : "Este producto ya tiene ventas y debe conservarse en el historial." });
    return;
  }
  const [deleted] = await db.delete(productsTable).where(eq(productsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Producto no encontrado." });
    return;
  }
  await db.insert(inventoryActivityTable).values({ id: randomUUID(), kind: "producto", title: "Producto eliminado", detail: deleted.name });
  res.sendStatus(204);
});

router.post("/inventory/purchases/analyze", requireAuth, async (req, res): Promise<void> => {
  const now = Date.now();
  const ip = req.ip || "unknown";
  const recent = (uploadAttempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 6) {
    res.status(429).json({ error: "Demasiados análisis. Espera un minuto e inténtalo de nuevo." });
    return;
  }
  recent.push(now);
  uploadAttempts.set(ip, recent);
  const parsed = AnalyzePurchaseUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Carga no válida." });
    return;
  }
  const { fileName, mimeType, dataBase64 } = parsed.data;
  const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
    res.status(400).json({ error: "El archivo no tiene una codificación válida." });
    return;
  }
  const buffer = Buffer.from(cleanBase64, "base64");
  if (!buffer.length) {
    res.status(400).json({ error: "El archivo está vacío." });
    return;
  }
  if (buffer.length > uploadLimitBytes) {
    res.status(413).json({ error: "El archivo supera el límite de 10 MB." });
    return;
  }
  try {
    const kind = validatePurchaseUploadType(fileName, mimeType, buffer);
    const isImage = (["png", "jpeg", "webp"] as PurchaseUploadKind[]).includes(kind);
    let rows: unknown[][];
    const warnings: string[] = [];
    if (isImage) {
      if (ocrInProgress) {
        res.status(429).json({ error: "Hay otro análisis de imagen en curso. Inténtalo en unos segundos." });
        return;
      }
      validateImagePixels(buffer, kind as "png" | "jpeg" | "webp");
      ocrInProgress = true;
      let ocr;
      try {
        ocr = await recognizePurchaseImage(buffer);
      } finally {
        ocrInProgress = false;
      }
      rows = rowsFromOcr(ocr.text);
      warnings.push("Los datos fueron extraídos por OCR. Revisa cada campo antes de confirmar.");
      if (ocr.confidence < 70) warnings.push("La imagen tiene baja confianza de lectura; corrige los valores dudosos.");
    } else if (kind === "xlsx") {
      validateZipComplexity(buffer);
      rows = await parseXlsxIsolated(buffer);
    } else rows = parseCsvRows(buffer);
    const extracted = parsePurchaseRows(rows);
    const skus = [...new Set(extracted.parsed.map((item) => item.sku))];
    const existing = skus.length ? await db.select().from(productsTable).where(inArray(productsTable.sku, skus)) : [];
    const items = completePurchasePreview(extracted.parsed, existing);
    res.json(AnalyzePurchaseUploadResponse.parse({ fileName, items, warnings: [...warnings, ...extracted.warnings] }));
  } catch (error) {
    req.log.warn({ err: error }, "Could not analyze purchase upload");
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo leer el archivo." });
  }
});

router.get("/inventory/purchases", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(purchasesTable).orderBy(desc(purchasesTable.createdAt)).limit(50);
  res.json(ListPurchasesResponse.parse(await Promise.all(rows.map(purchaseJson))));
});

router.post("/inventory/purchases", requireAuth, async (req, res): Promise<void> => {
  const parsed = ConfirmPurchaseImportBody.safeParse(req.body);
  if (!parsed.success || parsed.data.items.some((item) => !Number.isInteger(item.quantity))) {
    res.status(400).json({ error: "La compra contiene datos no válidos." });
    return;
  }
  try {
    const purchase = await db.transaction(async (tx) => {
      const grouped = groupPurchaseItems(parsed.data.items);
      const existing = await tx.select().from(productsTable).where(inArray(productsTable.sku, [...grouped.keys()])).for("update");
      const bySku = new Map(existing.map((product) => [product.sku, product]));
      const id = randomUUID();
      const itemRows = [];
      const catalogProducts = new Map<string, typeof productsTable.$inferSelect>();
      for (const [sku, aggregate] of grouped) {
        const input = aggregate.catalog;
        const old = bySku.get(sku);
        let product: typeof productsTable.$inferSelect;
        if (old) {
          const values = input.updateCatalog
            ? { name: input.name.trim(), category: input.category.trim(), cost: input.cost, price: input.price, stock: old.stock + aggregate.quantity }
            : { stock: old.stock + aggregate.quantity };
          product = (await tx.update(productsTable).set(values).where(eq(productsTable.id, old.id)).returning())[0];
        } else {
          product = (await tx.insert(productsTable).values({
            id: randomUUID(),
            sku,
            name: input.name.trim(),
            category: input.category.trim(),
            description: `Producto importado: ${input.name.trim()}`,
            cost: input.cost,
            price: input.price,
            stock: aggregate.quantity,
            lowStockThreshold: 5,
            imagePath: null,
          }).returning())[0];
        }
        catalogProducts.set(sku, product);
      }
      for (const input of parsed.data.items) {
        const sku = input.sku.trim().toUpperCase();
        const product = catalogProducts.get(sku)!;
        itemRows.push({ id: randomUUID(), purchaseId: id, ...purchaseLineValues(input, product) });
      }
      const totalCost = money(itemRows.reduce((total, item) => total + item.subtotal, 0));
      const [created] = await tx.insert(purchasesTable).values({ id, sourceFileName: parsed.data.sourceFileName.trim(), totalCost }).returning();
      await tx.insert(purchaseItemsTable).values(itemRows);
      await tx.insert(inventoryActivityTable).values({ id: randomUUID(), kind: "compra", title: "Compra importada", detail: `${itemRows.length} producto${itemRows.length === 1 ? "" : "s"} · ${parsed.data.sourceFileName.trim()}`, amount: totalCost });
      return created;
    });
    res.status(201).json(ConfirmPurchaseImportResponse.parse(await purchaseJson(purchase)));
  } catch (error) {
    req.log.warn({ err: error }, "Could not confirm purchase import");
    res.status(400).json({ error: "No se pudo registrar la compra." });
  }
});

router.get("/sales", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(salesTable).orderBy(desc(salesTable.createdAt)).limit(50);
  res.json(ListSalesResponse.parse(await Promise.all(rows.map(saleJson))));
});

router.post("/sales", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success || parsed.data.items.some((item) => !Number.isInteger(item.quantity))) {
    res.status(400).json({ error: "La venta contiene datos no válidos." });
    return;
  }
  const grouped = new Map<string, number>();
  for (const item of parsed.data.items) grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
  try {
    const sale = await db.transaction(async (tx) => {
      const products = await tx.select().from(productsTable).where(inArray(productsTable.id, [...grouped.keys()])).for("update");
      if (products.length !== grouped.size) throw new Error("Uno de los productos ya no existe.");
      for (const product of products) {
        const quantity = grouped.get(product.id)!;
        if (quantity > product.stock) throw new Error(`No hay suficiente existencia de ${product.name}. Disponible: ${product.stock}.`);
      }
      const subtotal = money(products.reduce((sum, product) => sum + product.price * grouped.get(product.id)!, 0));
      if (parsed.data.paymentMethod === "Efectivo" && (parsed.data.amountReceived ?? 0) < subtotal) throw new Error("El monto recibido es menor al total.");
      const id = randomUUID();
      const receiptNumber = `V-${Date.now().toString().slice(-8)}`;
      const amountReceived = parsed.data.paymentMethod === "Efectivo" ? parsed.data.amountReceived : null;
      const [created] = await tx.insert(salesTable).values({
        id,
        receiptNumber,
        paymentMethod: parsed.data.paymentMethod,
        customerName: parsed.data.customerName.trim(),
        customerIdNumber: parsed.data.customerIdNumber.trim(),
        customerPhone: parsed.data.customerPhone.trim(),
        subtotal,
        total: subtotal,
        amountReceived,
        changeDue: money(Math.max(0, (amountReceived ?? subtotal) - subtotal)),
      }).returning();
      await tx.insert(saleItemsTable).values(products.map((product) => {
        const quantity = grouped.get(product.id)!;
        return { id: randomUUID(), saleId: id, productId: product.id, productName: product.name, quantity, unitPrice: product.price, unitCost: product.cost, subtotal: money(product.price * quantity) };
      }));
      for (const product of products) {
        await tx.update(productsTable).set({ stock: product.stock - grouped.get(product.id)! }).where(and(eq(productsTable.id, product.id), lte(sql`${grouped.get(product.id)!}`, productsTable.stock)));
      }
      await tx.insert(inventoryActivityTable).values({ id: randomUUID(), kind: "venta", title: `Venta ${receiptNumber}`, detail: `${products.length} producto${products.length === 1 ? "" : "s"} · ${parsed.data.paymentMethod}`, amount: subtotal });
      return created;
    });
    res.status(201).json(CreateSaleResponse.parse(await saleJson(sale)));
  } catch (error) {
    req.log.warn({ err: error }, "Could not create sale");
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo registrar la venta." });
  }
});

router.get("/inventory/dashboard", async (_req, res): Promise<void> => {
  const [products] = await db.select({
    totalProducts: sql<number>`count(*)::float`,
    totalUnits: sql<number>`coalesce(sum(${productsTable.stock}), 0)::float`,
    lowStockProducts: sql<number>`count(*) filter (where ${productsTable.stock} <= ${productsTable.lowStockThreshold})::float`,
    inventoryCostValue: sql<number>`coalesce(sum(${productsTable.stock} * ${productsTable.cost}), 0)::float`,
    inventorySaleValue: sql<number>`coalesce(sum(${productsTable.stock} * ${productsTable.price}), 0)::float`,
  }).from(productsTable);
  const [sales] = await db.select({
    totalSold: sql<number>`coalesce(sum(${salesTable.total}), 0)::float`,
    salesToday: sql<number>`coalesce(sum(${salesTable.total}) filter (where ${salesTable.createdAt} >= current_date), 0)::float`,
  }).from(salesTable);
  const [profit] = await db.select({
    profitToday: sql<number>`coalesce(sum((${saleItemsTable.unitPrice} - ${saleItemsTable.unitCost}) * ${saleItemsTable.quantity}) filter (where ${salesTable.createdAt} >= current_date), 0)::float`,
  }).from(saleItemsTable).innerJoin(salesTable, eq(saleItemsTable.saleId, salesTable.id));
  const paymentTotals = await db.select({ method: salesTable.paymentMethod, total: sql<number>`sum(${salesTable.total})::float` }).from(salesTable).where(sql`${salesTable.createdAt} >= current_date`).groupBy(salesTable.paymentMethod);
  res.json(GetInventoryDashboardResponse.parse({ ...products, ...sales, ...profit, paymentTotals }));
});

router.get("/inventory/activity", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inventoryActivityTable).orderBy(desc(inventoryActivityTable.createdAt)).limit(20);
  res.json(GetInventoryActivityResponse.parse(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))));
});

export default router;