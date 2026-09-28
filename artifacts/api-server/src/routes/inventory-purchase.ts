const headerAliases: Record<string, string[]> = {
  sku: ["sku", "codigo", "código", "codigo producto", "product code", "item code", "referencia", "reference"],
  name: ["producto", "nombre", "nombre producto", "product", "product name", "descripcion", "descripción", "description", "articulo", "artículo", "item"],
  category: ["categoria", "categoría", "category", "tipo", "type"],
  quantity: ["cantidad", "qty", "quantity", "unidades", "units", "cant"],
  cost: ["costo", "cost", "costo unitario", "unit cost", "precio compra", "purchase price"],
  price: ["precio", "price", "precio venta", "sale price", "selling price", "pvp"],
};

export type ParsedPurchaseItem = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  cost?: number;
  price?: number;
  warnings: string[];
};

export type MissingPurchaseField = "cost" | "price";

export type PurchaseImportItem = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  cost: number;
  price: number;
  updateCatalog: boolean;
};

type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  cost: number;
  price: number;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function fieldForHeader(value: unknown) {
  const valueNormalized = normalized(value);
  const entries = Object.entries(headerAliases);
  const exact = entries.find(([, aliases]) => aliases.some((alias) => normalized(alias) === valueNormalized));
  if (exact) return exact[0];
  return entries.find(([, aliases]) => aliases.some((alias) => {
    const normalizedAlias = normalized(alias);
    return normalizedAlias.length >= 3 && valueNormalized.includes(normalizedAlias);
  }))?.[0];
}

function localeNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  let text = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!text) return undefined;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (comma >= 0) text = text.replace(",", ".");
  const result = Number(text);
  return Number.isFinite(result) ? result : undefined;
}

export function rowsFromOcr(text: string): unknown[][] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (line.includes(";")) return line.split(";").map((cell) => cell.trim());
    if (line.includes("\t")) return line.split(/\t+/).map((cell) => cell.trim());
    if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map((cell) => cell.trim());
    return [line];
  });
}

export function parsePurchaseRows(rows: unknown[][]) {
  if (!rows.length) throw new Error("El archivo no contiene filas legibles.");
  const headerIndex = rows.slice(0, 12).findIndex((row) => ["sku", "name", "quantity"].every((field) => row.map(fieldForHeader).includes(field)));
  if (headerIndex < 0) {
    const inferred = rows.slice(0, 2_000).flatMap((row): ParsedPurchaseItem[] => {
      const cells = row.map((value) => String(value).trim()).filter(Boolean);
      if (cells.length === 1) {
        const match = cells[0].match(/^(\S+)\s+(.+?)\s+(\d+)\s+([€$]?[0-9.,]+)\s+([€$]?[0-9.,]+)$/);
        if (match) {
          const quantity = localeNumber(match[3]);
          const cost = localeNumber(match[4]);
          const price = localeNumber(match[5]);
          if (quantity && Number.isInteger(quantity) && cost !== undefined && price !== undefined) {
            return [{ sku: match[1].toUpperCase(), name: match[2], category: "", quantity, cost, price, warnings: [] }];
          }
        }
      }
      const numericTail = cells.slice(-3).map(localeNumber);
      if (cells.length < 5 || numericTail.some((value) => value === undefined)) return [];
      const [quantity, cost, price] = numericTail as number[];
      if (!Number.isInteger(quantity) || quantity < 1) return [];
      return [{ sku: cells[0].toUpperCase(), name: cells.slice(1, -3).join(" "), category: "", quantity, cost, price, warnings: [] }];
    });
    if (inferred.length) return { parsed: inferred, warnings: ["No se detectaron encabezados; se infirieron SKU, nombre y los tres valores finales (cantidad, costo y venta). Revisa las filas."] };
    throw new Error("No se encontraron las columnas SKU, producto y cantidad. Revisa los encabezados.");
  }
  const headers = rows[headerIndex].map(fieldForHeader);
  const warnings: string[] = [];
  const parsed = rows.slice(headerIndex + 1, headerIndex + 2_001).flatMap((row, index): ParsedPurchaseItem[] => {
    const values = Object.fromEntries(headers.map((header, column) => [header, row[column]]));
    const sku = String(values.sku ?? "").trim().toUpperCase();
    const name = String(values.name ?? "").trim();
    const quantity = localeNumber(values.quantity);
    if (!sku && !name && quantity === undefined) return [];
    if (!sku || !name || !quantity || !Number.isInteger(quantity) || quantity < 1) {
      warnings.push(`Fila ${index + headerIndex + 2}: faltan SKU, producto o una cantidad entera válida.`);
      return [];
    }
    return [{
      sku,
      name,
      category: String(values.category ?? "").trim(),
      quantity,
      cost: localeNumber(values.cost),
      price: localeNumber(values.price),
      warnings: [],
    }];
  });
  if (!parsed.length) throw new Error("No se encontraron artículos válidos para importar.");
  return { parsed, warnings };
}

export function completePurchasePreview(parsed: ParsedPurchaseItem[], existing: CatalogProduct[]) {
  const bySku = new Map(existing.map((product) => [product.sku, product]));
  return parsed.map((item) => {
    const found = bySku.get(item.sku);
    if (found) {
      return {
        ...item,
        name: item.name || found.name,
        category: item.category || found.category,
        cost: item.cost ?? found.cost,
        price: item.price ?? found.price,
        updateCatalog: false,
        existingProductId: found.id,
        status: "existing" as const,
        missingFields: [] as MissingPurchaseField[],
      };
    }
    const warnings = [...item.warnings];
    const missingFields: MissingPurchaseField[] = [];
    if (item.cost === undefined) { missingFields.push("cost"); warnings.push("Falta costo; corrígelo antes de confirmar."); }
    if (item.price === undefined) { missingFields.push("price"); warnings.push("Falta precio de venta; corrígelo antes de confirmar."); }
    return {
      ...item,
      category: item.category || "Sin categoría",
      cost: item.cost ?? 0,
      price: item.price ?? 0,
      warnings,
      updateCatalog: false,
      existingProductId: null,
      status: "new" as const,
      missingFields,
    };
  });
}

export function groupPurchaseItems(items: PurchaseImportItem[]) {
  const grouped = new Map<string, { quantity: number; catalog: PurchaseImportItem }>();
  for (const item of items) {
    const sku = item.sku.trim().toUpperCase();
    const current = grouped.get(sku);
    grouped.set(sku, { quantity: (current?.quantity ?? 0) + item.quantity, catalog: current?.catalog ?? { ...item, sku } });
  }
  return grouped;
}

export function purchaseLineValues(input: PurchaseImportItem, product: CatalogProduct) {
  const sku = input.sku.trim().toUpperCase();
  return {
    productId: product.id,
    productName: input.name.trim(),
    sku,
    category: input.category.trim(),
    quantity: input.quantity,
    unitCost: input.cost,
    unitPrice: input.price,
    subtotal: Math.round((input.cost * input.quantity + Number.EPSILON) * 100) / 100,
  };
}