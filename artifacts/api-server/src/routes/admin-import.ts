// One-off import of the three sales made on 2026-09-08 in the Replit production
// database, which was not included in the migration backup. Guarded by the
// ADMIN_IMPORT_TOKEN header and idempotent by receipt number. Remove after use.
import { randomUUID, timingSafeEqual } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, inventoryActivityTable, productsTable, saleItemsTable, salesTable } from "@workspace/db";

const router: IRouter = Router();

type Line = { productId: string; quantity: number; unitPrice: number };
type HistoricSale = { receiptNumber: string; customerName: string; createdAt: string; total: number; lines: Line[] };

const HOJAS_BILLETES = "img-hojas-billetes";
const PROTECTORES_CARTAS = "img-protectores-cartas";
const HOJAS_MONEDAS_30 = "img-hojas-monedas-2";

// Times are Caracas (UTC-4) converted to UTC. Line prices make each receipt
// add up exactly to the total shown in the original receipt.
const SALES: HistoricSale[] = [
  {
    receiptNumber: "V-93817440",
    customerName: "NANYERLIN PARRA",
    createdAt: "2026-09-08T18:56:00Z",
    total: 31.85,
    lines: [
      { productId: HOJAS_BILLETES, quantity: 10, unitPrice: 1.8 },
      { productId: PROTECTORES_CARTAS, quantity: 1, unitPrice: 6.35 },
      { productId: HOJAS_MONEDAS_30, quantity: 3, unitPrice: 2.5 },
    ],
  },
  {
    receiptNumber: "V-94567025",
    customerName: "REAM REPUESTOS",
    createdAt: "2026-09-08T19:09:00Z",
    total: 17.0,
    lines: [{ productId: HOJAS_BILLETES, quantity: 10, unitPrice: 1.7 }],
  },
  {
    receiptNumber: "V-94643806",
    customerName: "REAM REPUESTOS",
    createdAt: "2026-09-08T19:10:00Z",
    total: 16.9,
    lines: [{ productId: HOJAS_BILLETES, quantity: 10, unitPrice: 1.69 }],
  },
];

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function tokenOk(provided: unknown): boolean {
  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post("/admin/import-historic-sales", async (req, res): Promise<void> => {
  if (!tokenOk(req.headers["x-admin-token"])) {
    res.sendStatus(404);
    return;
  }
  const dryRun = req.query.dryRun === "1";
  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select({ receiptNumber: salesTable.receiptNumber }).from(salesTable)
        .where(inArray(salesTable.receiptNumber, SALES.map((sale) => sale.receiptNumber)));
      const already = new Set(existing.map((row) => row.receiptNumber));
      const productIds = [...new Set(SALES.flatMap((sale) => sale.lines.map((line) => line.productId)))];
      const products = await tx.select().from(productsTable).where(inArray(productsTable.id, productIds)).for("update");
      const byId = new Map(products.map((product) => [product.id, product]));
      if (byId.size !== productIds.length) throw new Error("Falta algún producto en el catálogo.");
      const before = Object.fromEntries(products.map((product) => [product.name, product.stock]));
      const deduct = new Map<string, number>();
      const imported: string[] = [];
      for (const sale of SALES) {
        if (already.has(sale.receiptNumber)) continue;
        const subtotal = money(sale.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
        if (subtotal !== sale.total) throw new Error(`${sale.receiptNumber}: líneas ${subtotal} ≠ total ${sale.total}`);
        for (const line of sale.lines) deduct.set(line.productId, (deduct.get(line.productId) ?? 0) + line.quantity);
        imported.push(sale.receiptNumber);
        if (dryRun) continue;
        const saleId = randomUUID();
        const createdAt = new Date(sale.createdAt);
        await tx.insert(salesTable).values({
          id: saleId,
          receiptNumber: sale.receiptNumber,
          customerName: sale.customerName,
          paymentMethod: "Sin especificar",
          subtotal,
          total: sale.total,
          amountReceived: null,
          changeDue: 0,
          createdAt,
        });
        await tx.insert(saleItemsTable).values(sale.lines.map((line) => {
          const product = byId.get(line.productId)!;
          return {
            id: randomUUID(),
            saleId,
            productId: product.id,
            productName: product.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: product.cost,
            subtotal: money(line.unitPrice * line.quantity),
          };
        }));
        await tx.insert(inventoryActivityTable).values({
          id: randomUUID(),
          kind: "venta",
          title: `Venta ${sale.receiptNumber}`,
          detail: `${sale.lines.length} producto${sale.lines.length === 1 ? "" : "s"} · ${sale.customerName}`,
          amount: sale.total,
          createdAt,
        });
      }
      for (const [productId, quantity] of deduct) {
        const product = byId.get(productId)!;
        if (quantity > product.stock) throw new Error(`Existencia insuficiente de ${product.name}.`);
        if (!dryRun) await tx.update(productsTable).set({ stock: sql`${productsTable.stock} - ${quantity}` }).where(eq(productsTable.id, productId));
      }
      const after = Object.fromEntries(products.map((product) => [product.name, product.stock - (deduct.get(product.id) ?? 0)]));
      return { dryRun, imported, skipped: [...already], before, after };
    });
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Historic sales import failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

export default router;
