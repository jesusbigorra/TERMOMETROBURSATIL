import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable(
  "inventory_products",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    cost: doublePrecision("cost").notNull(),
    price: doublePrecision("price").notNull(),
    stock: integer("stock").notNull(),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    imagePath: text("image_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("inventory_products_sku_unique").on(table.sku),
    index("inventory_products_name_idx").on(table.name),
  ],
);

export const salesTable = pgTable(
  "inventory_sales",
  {
    id: text("id").primaryKey(),
    receiptNumber: text("receipt_number").notNull(),
    customerName: text("customer_name").notNull().default(""),
    customerIdNumber: text("customer_id_number").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    paymentMethod: text("payment_method").notNull(),
    subtotal: doublePrecision("subtotal").notNull(),
    total: doublePrecision("total").notNull(),
    amountReceived: doublePrecision("amount_received"),
    changeDue: doublePrecision("change_due").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inventory_sales_receipt_unique").on(table.receiptNumber),
    index("inventory_sales_created_idx").on(table.createdAt),
  ],
);

export const saleItemsTable = pgTable(
  "inventory_sale_items",
  {
    id: text("id").primaryKey(),
    saleId: text("sale_id").notNull().references(() => salesTable.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => productsTable.id),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: doublePrecision("unit_price").notNull(),
    unitCost: doublePrecision("unit_cost").notNull(),
    subtotal: doublePrecision("subtotal").notNull(),
  },
  (table) => [
    index("inventory_sale_items_sale_idx").on(table.saleId),
    index("inventory_sale_items_product_idx").on(table.productId),
  ],
);

export const purchasesTable = pgTable(
  "inventory_purchases",
  {
    id: text("id").primaryKey(),
    sourceFileName: text("source_file_name").notNull(),
    totalCost: doublePrecision("total_cost").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("inventory_purchases_created_idx").on(table.createdAt)],
);
export const inventoryActivityTable = pgTable(
  "inventory_activity",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    amount: doublePrecision("amount"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("inventory_activity_created_idx").on(table.createdAt)],
);

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true });

export type Purchase = typeof purchasesTable.$inferSelect;

export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;

export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;

export type InsertPurchaseItem = z.infer<typeof insertPurchaseItemSchema>;

export const purchaseItemsTable = pgTable(
  "inventory_purchase_items",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id").notNull().references(() => purchasesTable.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => productsTable.id),
    productName: text("product_name").notNull(),
    sku: text("sku").notNull(),
    category: text("category").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: doublePrecision("unit_cost").notNull(),
    unitPrice: doublePrecision("unit_price").notNull(),
    subtotal: doublePrecision("subtotal").notNull(),
  },
  (table) => [
    index("inventory_purchase_items_purchase_idx").on(table.purchaseId),
    index("inventory_purchase_items_product_idx").on(table.productId),
  ],
);

export const insertPurchaseItemSchema = createInsertSchema(purchaseItemsTable).omit({ id: true });
