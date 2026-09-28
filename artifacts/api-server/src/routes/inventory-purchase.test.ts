import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfirmPurchaseImportBody } from "@workspace/api-zod";
import {
  completePurchasePreview,
  groupPurchaseItems,
  parsePurchaseRows,
  purchaseLineValues,
  rowsFromOcr,
  type PurchaseImportItem,
} from "./inventory-purchase.ts";

test("OCR conserva comas decimales e infiere una fila separada por espacios simples", () => {
  const rows = rowsFromOcr("SKU Producto 2 1,50 3,00");

  assert.deepEqual(rows, [["SKU Producto 2 1,50 3,00"]]);
  const result = parsePurchaseRows(rows);
  assert.deepEqual(result.parsed[0], {
    sku: "SKU",
    name: "Producto",
    category: "",
    quantity: 2,
    cost: 1.5,
    price: 3,
    warnings: [],
  });
});

test("OCR usa punto y coma, tabulaciones o espacios múltiples como separadores estructurales", () => {
  assert.deepEqual(rowsFromOcr("A;Producto;2;1,50;3,00"), [["A", "Producto", "2", "1,50", "3,00"]]);
  assert.deepEqual(rowsFromOcr("A\tProducto\t2\t1,50\t3,00"), [["A", "Producto", "2", "1,50", "3,00"]]);
  assert.deepEqual(rowsFromOcr("A  Producto  2  1,50  3,00"), [["A", "Producto", "2", "1,50", "3,00"]]);
});

test("completa columnas opcionales mínimas desde el catálogo existente", () => {
  const extracted = parsePurchaseRows([
    ["SKU", "Producto", "Cantidad"],
    ["abc", "Nombre importado", "4"],
  ]);
  const [preview] = completePurchasePreview(extracted.parsed, [{
    id: "product-1",
    sku: "ABC",
    name: "Nombre catálogo",
    category: "Bebidas",
    cost: 2.25,
    price: 4.5,
  }]);

  assert.equal(preview.name, "Nombre importado");
  assert.equal(preview.category, "Bebidas");
  assert.equal(preview.cost, 2.25);
  assert.equal(preview.price, 4.5);
  assert.equal(preview.status, "existing");
  assert.deepEqual(preview.warnings, []);
  assert.deepEqual(preview.missingFields, []);
});

test("marca costo y precio ausentes sin confundirlos con ceros reales", () => {
  const extracted = parsePurchaseRows([
    ["SKU", "Producto", "Cantidad"],
    ["nuevo", "Producto nuevo", "2"],
  ]);
  const [preview] = completePurchasePreview(extracted.parsed, []);
  assert.equal(preview.cost, 0);
  assert.equal(preview.price, 0);
  assert.deepEqual(preview.missingFields, ["cost", "price"]);

  const [withZeroes] = completePurchasePreview([{ ...extracted.parsed[0], cost: 0, price: 0 }], []);
  assert.deepEqual(withZeroes.missingFields, []);
});

test("agrupa existencias por SKU sin perder costos de cada línea de compra", () => {
  const items: PurchaseImportItem[] = [
    { sku: "abc", name: "Producto", category: "Cat", quantity: 2, cost: 1.5, price: 3, updateCatalog: false },
    { sku: "ABC", name: "Producto", category: "Cat", quantity: 3, cost: 2, price: 4, updateCatalog: false },
  ];
  const grouped = groupPurchaseItems(items);
  const product = { id: "product-1", sku: "ABC", name: "Producto", category: "Cat", cost: 8, price: 9 };
  const lines = items.map((item) => purchaseLineValues(item, product));

  assert.equal(grouped.size, 1);
  assert.equal(grouped.get("ABC")?.quantity, 5);
  assert.deepEqual(lines.map(({ unitCost, subtotal }) => ({ unitCost, subtotal })), [
    { unitCost: 1.5, subtotal: 3 },
    { unitCost: 2, subtotal: 6 },
  ]);
});

test("procesa más de 500 artículos sin truncar silenciosamente la compra", () => {
  const rows: unknown[][] = [["SKU", "Producto", "Categoría", "Cantidad", "Costo", "Precio"]];
  for (let index = 0; index < 501; index += 1) {
    rows.push([`SKU-${index}`, `Producto ${index}`, "General", 1, 2, 3]);
  }

  const result = parsePurchaseRows(rows);
  const preview = completePurchasePreview(result.parsed, []);
  const confirmation = ConfirmPurchaseImportBody.safeParse({
    sourceFileName: "compra-501.csv",
    items: preview.map(({ sku, name, category, quantity, cost, price, updateCatalog }) => ({
      sku, name, category, quantity, cost, price, updateCatalog,
    })),
  });

  assert.equal(result.parsed.length, 501);
  assert.equal(result.parsed[500]?.sku, "SKU-500");
  assert.equal(confirmation.success, true);
});