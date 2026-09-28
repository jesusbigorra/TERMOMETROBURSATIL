import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { parsePurchaseRows } from "./inventory-purchase.ts";
import { imageDimensions, parseCsvRows, parseXlsxIsolated, sniffPurchaseUpload, validateProductImageContent, validatePurchaseUploadType } from "./inventory-upload.ts";

test("detecta tipos reales por firma y rechaza una imagen disfrazada", () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(2, 16);
  png.writeUInt32BE(3, 20);
  assert.equal(sniffPurchaseUpload(png), "png");
  assert.deepEqual(imageDimensions(png, "png"), { width: 2, height: 3 });
  assert.throws(() => validatePurchaseUploadType("factura.jpg", "image/jpeg", png), /no coincide/);
  assert.throws(() => validateProductImageContent(png, "image/jpeg"), /no coincide/);
  assert.equal(validateProductImageContent(png, "image/png"), "png");
});

test("CSV exige texto UTF-8 acotado y sin disfraz binario", () => {
  assert.equal(sniffPurchaseUpload(Buffer.from("SKU,Producto,Cantidad\nA,Café,2")), "csv");
  assert.deepEqual(parseCsvRows(Buffer.from('SKU,Producto\nA,"Café, molido"')), [["SKU", "Producto"], ["A", "Café, molido"]]);
  assert.equal(sniffPurchaseUpload(Buffer.from([0x53, 0x4b, 0x55, 0, 0xff])), undefined);
});

test("CSV separado por punto y coma conserva las comas decimales", () => {
  const rows = parseCsvRows(Buffer.from(
    "SKU;Producto;Cantidad;Costo;Precio Venta\nA-1;Café;2;1,50;3,00",
  ));
  const parsed = parsePurchaseRows(rows);

  assert.deepEqual(parsed.parsed[0], {
    sku: "A-1",
    name: "Café",
    category: "",
    quantity: 2,
    cost: 1.5,
    price: 3,
    warnings: [],
  });
});

test("Excel moderno se analiza dentro del worker aislado", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Compra");
  sheet.addRow(["SKU", "Producto", "Cantidad", "Costo", "Precio"]);
  sheet.addRow(["A-1", "Café", 2, 1.5, 3]);
  const bytes = await workbook.xlsx.writeBuffer();

  const rows = await parseXlsxIsolated(Buffer.from(bytes));

  assert.deepEqual(rows, [
    ["SKU", "Producto", "Cantidad", "Costo", "Precio"],
    ["A-1", "Café", 2, 1.5, 3],
  ]);
});