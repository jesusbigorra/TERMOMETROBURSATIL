import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListProductsQueryKey,
  getGetInventoryDashboardQueryKey,
  getGetInventoryActivityQueryKey,
  getListPurchasesQueryKey,
  useAnalyzePurchaseUpload,
  useConfirmPurchaseImport,
  useListPurchases,
} from "@workspace/api-client-react";
import type { Product, ProductInput, ProductUpdate, PurchasePreviewItem } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Search, Pencil, Trash2, AlertTriangle, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@clerk/react";
import { ImagePlus, Image as ImageIcon, X } from "lucide-react";
import { Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const productSchema = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  description: z.string().max(500),
  cost: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  stock: z.coerce.number().min(0),
  lowStockThreshold: z.coerce.number().min(0),
  imagePath: z.string().nullable(),
});

type ProductFormValues = z.infer<typeof productSchema>;

// Vercel rejects requests above 4.5 MB, and phone photos are often larger, so every photo is
// shrunk in the browser (longest side 1600 px, JPEG) before it is uploaded.
const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;
const MAX_PICKED_BYTES = 25 * 1024 * 1024;

async function prepareProductImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "foto"}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function ProductsPage() {
  const { isSignedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useListProducts();
  const { data: purchases } = useListPurchases({ query: { queryKey: getListPurchasesQueryKey(), enabled: Boolean(isSignedIn) } });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const analyzePurchase = useAnalyzePurchaseUpload();
  const confirmPurchase = useConfirmPurchaseImport();

  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [purchaseFileName, setPurchaseFileName] = useState("");
  const [purchaseItems, setPurchaseItems] = useState<PurchasePreviewItem[]>([]);
  const [purchaseWarnings, setPurchaseWarnings] = useState<string[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const importOpenRef = useRef(false);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: "", name: "", category: "", description: "", cost: 0, price: 0, stock: 0, lowStockThreshold: 5, imagePath: null
    }
  });

  // Reset form when opening/closing or changing edit target
  useEffect(() => {
    if (editingProduct) {
      form.reset({
        sku: editingProduct.sku,
        name: editingProduct.name,
        category: editingProduct.category,
        description: editingProduct.description,
        cost: editingProduct.cost,
        price: editingProduct.price,
        stock: editingProduct.stock,
        lowStockThreshold: editingProduct.lowStockThreshold,
        imagePath: editingProduct.imagePath,
      });
    } else {
      form.reset({
        sku: "", name: "", category: "", description: "", cost: 0, price: 0, stock: 0, lowStockThreshold: 5, imagePath: null
      });
    }
  }, [editingProduct, isDialogOpen, form]);
  useEffect(() => { importOpenRef.current = isImportOpen; }, [isImportOpen]);

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const lowerSearch = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(lowerSearch) ||
      p.description.toLowerCase().includes(lowerSearch) ||
      p.sku.toLowerCase().includes(lowerSearch) ||
      p.category.toLowerCase().includes(lowerSearch)
    );
  }, [products, search]);

  const handleOpenCreate = () => {
    setEditingProduct(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleOpenDelete = (product: Product) => {
    setProductToDelete(product);
  };
  const handleImageUpload = async (picked?: File) => {
    if (!picked) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(picked.type) || picked.size > MAX_PICKED_BYTES) {
      toast({ title: "Foto no válida", description: "Usa JPG, PNG o WEBP de hasta 25 MB.", variant: "destructive" });
      return;
    }
    setIsUploadingImage(true);
    try {
      const file = await prepareProductImage(picked);
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("La foto sigue siendo demasiado pesada. Prueba con otra.");
      const request = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!request.ok) throw new Error("No se pudo autorizar la carga.");
      const { uploadURL, objectPath } = await request.json() as { uploadURL: string; objectPath: string };
      const upload = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!upload.ok) throw new Error("No se pudo subir la foto.");
      const finalize = await fetch("/api/storage/uploads/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath }),
      });
      if (!finalize.ok) throw new Error("No se pudo proteger y publicar la foto.");
      form.setValue("imagePath", objectPath, { shouldDirty: true });
      toast({ title: "Foto cargada", description: "Guarda el producto para conservar el cambio." });
    } catch (error) {
      toast({ title: "Error al cargar", description: error instanceof Error ? error.message : "Inténtalo nuevamente.", variant: "destructive" });
    } finally {
      setIsUploadingImage(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const onSubmit = (data: ProductFormValues) => {
    if (editingProduct) {
      updateProduct.mutate({ id: editingProduct.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInventoryDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInventoryActivityQueryKey() });
          toast({ title: "Producto actualizado", description: `${data.name} ha sido guardado.` });
          setIsDialogOpen(false);
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo actualizar el producto.", variant: "destructive" });
        }
      });
    } else {
      createProduct.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInventoryDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInventoryActivityQueryKey() });
          toast({ title: "Producto creado", description: `${data.name} ha sido añadido.` });
          setIsDialogOpen(false);
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo crear el producto.", variant: "destructive" });
        }
      });
    }
  };

  const confirmDelete = () => {
    if (!productToDelete) return;
    deleteProduct.mutate({ id: productToDelete.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInventoryDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInventoryActivityQueryKey() });
        toast({ title: "Producto eliminado", description: `${productToDelete.name} ha sido eliminado.` });
        setProductToDelete(null);
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo eliminar (probablemente tenga ventas asociadas).", variant: "destructive" });
        setProductToDelete(null);
      }
    });
  };
  const handlePurchaseFile = (file?: File) => {
    if (!file) return;
    if (![".xlsx", ".csv", ".jpg", ".jpeg", ".png", ".webp"].some((extension) => file.name.toLowerCase().endsWith(extension))) { toast({ title: "Formato no compatible", description: "Selecciona Excel .xlsx, CSV, PNG, JPG o WEBP.", variant: "destructive" }); return; }
    if (file.size > 10 * 1024 * 1024) { toast({ title: "Archivo demasiado grande", description: "El límite es 10 MB.", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = String(reader.result).split(",")[1];
      if (!dataBase64) return;
      analyzePurchase.mutate({ data: { fileName: file.name, mimeType: file.type || "application/octet-stream", dataBase64 } }, { onSuccess: (preview) => { if (importOpenRef.current) { setPurchaseFileName(preview.fileName); setPurchaseItems(preview.items); setPurchaseWarnings(preview.warnings); } }, onError: () => toast({ title: "No se pudo analizar", description: "Revisa el formato y los encabezados del archivo.", variant: "destructive" }) });
    };
    reader.readAsDataURL(file);
  };
  const updatePurchaseItem = (index: number, field: keyof PurchasePreviewItem, value: string) => setPurchaseItems((items) => items.map((item, itemIndex) => {
    if (index !== itemIndex) return item;
    const isMissingMoney = (field === "cost" || field === "price") && value.trim() === "";
    const missingFields = field === "cost" || field === "price"
      ? isMissingMoney ? [...new Set([...item.missingFields, field])] : item.missingFields.filter((missing) => missing !== field)
      : item.missingFields;
    const resolvedWarning = field === "cost" ? "Falta costo; corrígelo antes de confirmar." : "Falta precio de venta; corrígelo antes de confirmar.";
    const warnings = (field === "cost" || field === "price") && !isMissingMoney ? item.warnings.filter((warning) => warning !== resolvedWarning) : item.warnings;
    const next = { ...item, missingFields, warnings, [field]: ["quantity", "cost", "price"].includes(field) ? Number(value) : field === "updateCatalog" ? value === "true" : value };
    if (field !== "sku") return next;
    const existing = products?.find((product) => product.sku === value.trim().toUpperCase());
    return existing ? { ...next, existingProductId: existing.id, status: "existing" as const, updateCatalog: false } : { ...next, existingProductId: null, status: "new" as const, updateCatalog: false };
  }));
  const purchaseRowErrors = purchaseItems.map((item) => {
    const errors: string[] = [];
    if (!item.sku.trim()) errors.push("SKU requerido"); if (!item.name.trim()) errors.push("Producto requerido"); if (!item.category.trim()) errors.push("Categoría requerida");
    if (!Number.isInteger(item.quantity) || item.quantity < 1) errors.push("Cantidad debe ser entero ≥ 1");
    if (item.missingFields.includes("cost")) errors.push("Costo requerido"); if (item.missingFields.includes("price")) errors.push("Precio requerido");
    if (!Number.isFinite(item.cost) || item.cost < 0) errors.push("Costo inválido"); if (!Number.isFinite(item.price) || item.price < 0) errors.push("Precio inválido");
    return errors;
  });
  const cleanupPurchaseImport = () => {
    importOpenRef.current = false; setIsImportOpen(false); analyzePurchase.reset(); confirmPurchase.reset();
    setPurchaseItems([]); setPurchaseWarnings([]); setPurchaseFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const submitPurchase = () => confirmPurchase.mutate({ data: { sourceFileName: purchaseFileName, items: purchaseItems.map(({ sku, name, category, quantity, cost, price, updateCatalog }) => ({ sku, name, category, quantity, cost, price, updateCatalog })) } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventoryDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetInventoryActivityQueryKey() }); queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() }); toast({ title: "Compra registrada", description: `${purchaseItems.length} producto(s) fueron agregados al inventario.` }); cleanupPurchaseImport(); }, onError: () => toast({ title: "No se pudo confirmar", description: "Corrige los campos de la compra e inténtalo de nuevo.", variant: "destructive" }) });
  const closeImport = (open: boolean) => { if (open) { importOpenRef.current = true; setIsImportOpen(true); } else cleanupPurchaseImport(); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm text-muted-foreground">Gestiona tus productos y existencias.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {isSignedIn ? (
            <Button data-testid="button-import-purchase" variant="outline" onClick={() => setIsImportOpen(true)} className="flex-1 sm:flex-none">
              <Upload className="mr-2 h-4 w-4" />
              Importar compra
            </Button>
          ) : (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/sign-in">Inicia sesión para importar</Link>
            </Button>
          )}
          <Button data-testid="button-new-product" onClick={handleOpenCreate} className="flex-1 sm:flex-none">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Producto
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center space-x-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, SKU o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 focus-visible:ring-0 px-0 shadow-none text-base"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Costo unit.</TableHead>
                <TableHead className="text-right">Precio de venta</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Cargando productos...</TableCell>
                </TableRow>
              ) : filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No se encontraron productos.</TableCell>
                </TableRow>
              ) : (
                filteredProducts.map((product) => {
                  const isLowStock = product.stock <= product.lowStockThreshold;
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono-numbers text-xs text-muted-foreground">{product.sku}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                            {product.imagePath ? <img src={`/api/storage${product.imagePath}`} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground/50" />}
                          </div>
                          <div className="min-w-0">
                            <p>{product.name}</p>
                            <p className="max-w-[360px] truncate text-xs font-normal text-muted-foreground">{product.description}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">{product.category}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono-numbers text-muted-foreground">${product.cost.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono-numbers font-semibold">${product.price.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isLowStock && <AlertTriangle className="h-4 w-4 text-destructive" />}
                          <span className={`font-mono-numbers font-medium ${isLowStock ? 'text-destructive' : ''}`}>
                            {product.stock}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => handleOpenEdit(product)}>
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                            <span className="hidden xl:inline ml-2">Modificar precio</span>
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleOpenDelete(product)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    <Card><CardHeader className="pb-3"><CardTitle className="text-base">Historial de compras</CardTitle></CardHeader><CardContent className="space-y-2">{!purchases?.length ? <p data-testid="text-purchase-history-empty" className="text-sm text-muted-foreground">Aún no hay compras registradas.</p> : purchases.slice(0, 5).map((purchase) => <div data-testid={`row-purchase-history-${purchase.id}`} key={purchase.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"><span>{new Date(purchase.createdAt).toLocaleDateString()} · {purchase.sourceFileName}</span><span className="text-muted-foreground">{purchase.items.length} líneas · <strong className="text-foreground">${purchase.totalCost.toFixed(2)}</strong></span></div>)}</CardContent></Card>
    <Dialog open={isImportOpen} onOpenChange={closeImport}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{purchaseItems.length ? "2. Revisa y confirma la compra" : "1. Carga tu compra"}</DialogTitle></DialogHeader>{!purchaseItems.length ? <div className="space-y-4 py-4"><p className="text-sm text-muted-foreground">Acepta Excel .xlsx, .csv o una imagen legible (PNG, JPG, WEBP), hasta 10 MB.</p><input ref={fileInputRef} data-testid="input-purchase-file" type="file" accept=".xlsx,.csv,image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => handlePurchaseFile(event.target.files?.[0])} /><Button data-testid="button-select-purchase-file" type="button" onClick={() => fileInputRef.current?.click()} disabled={analyzePurchase.isPending}><Upload className="mr-2 h-4 w-4" />{analyzePurchase.isPending ? "Analizando…" : "Seleccionar archivo"}</Button></div> : <div className="space-y-4 py-2"><p data-testid="text-purchase-preview-file" className="text-sm font-medium">{purchaseFileName} · {purchaseItems.length} artículos</p>{purchaseWarnings.map((warning, index) => <p data-testid={`text-purchase-warning-${index}`} key={warning} className="text-sm text-amber-600">{warning}</p>)}<div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{["Estado", "SKU", "Producto", "Categoría", "Cant.", "Costo", "Venta", "Ficha", "Validación"].map((title) => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader><TableBody>{purchaseItems.map((item, index) => <TableRow key={`${item.sku}-${index}`}><TableCell><Badge variant={item.status === "existing" ? "secondary" : "outline"}>{item.status === "existing" ? "Existente" : "Nuevo"}</Badge></TableCell>{(["sku", "name", "category", "quantity", "cost", "price"] as const).map((field) => <TableCell key={field}><Input data-testid={`input-purchase-${field}-${index}`} value={(field === "cost" || field === "price") && item.missingFields.includes(field) ? "" : item[field]} type={["quantity", "cost", "price"].includes(field) ? "number" : "text"} step={field === "cost" || field === "price" ? "0.01" : "1"} onChange={(event) => updatePurchaseItem(index, field, event.target.value)} /></TableCell>)}<TableCell>{item.status === "existing" && <label className="flex items-center gap-1 text-xs"><input data-testid={`checkbox-update-catalog-${index}`} type="checkbox" checked={item.updateCatalog} onChange={(event) => updatePurchaseItem(index, "updateCatalog", String(event.target.checked))} />Actualizar ficha</label>}</TableCell><TableCell><div className="space-y-1">{item.warnings.map((warning, warningIndex) => <span data-testid={`text-purchase-row-warning-${index}-${warningIndex}`} key={warning} className="block text-xs text-amber-600">{warning}</span>)}{purchaseRowErrors[index].length > 0 && <span data-testid={`text-purchase-row-error-${index}`} className="block text-xs text-destructive">{purchaseRowErrors[index].join(" · ")}</span>}</div></TableCell></TableRow>)}</TableBody></Table></div></div>}<DialogFooter><Button data-testid="button-cancel-purchase-import" type="button" variant="outline" onClick={cleanupPurchaseImport}>Cancelar</Button>{purchaseItems.length > 0 && <Button data-testid="button-confirm-purchase-import" type="button" onClick={submitPurchase} disabled={confirmPurchase.isPending || purchaseRowErrors.some((errors) => errors.length > 0)}>{confirmPurchase.isPending ? "Guardando…" : "Confirmar compra"}</Button>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Editar Producto" : "Nuevo Producto"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                {(["sku", "category"] as const).map((name) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{name === "sku" ? "SKU" : "Categoría"}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </div>
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del producto</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción para identificarlo</FormLabel>
                  <FormControl><Textarea rows={3} placeholder="Ej.: Hoja para monedas, 9 agujeros, 30 posiciones" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="imagePath" render={({ field }) => (
                <FormItem>
                  <FormLabel>Foto del producto <span className="font-normal text-muted-foreground">(opcional)</span></FormLabel>
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {field.value ? <img src={`/api/storage${field.value}`} alt="Vista previa" className="h-full w-full object-cover" /> : <ImageIcon className="h-7 w-7 text-muted-foreground/50" />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      {isSignedIn ? (
                        <>
                          <input ref={uploadInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => handleImageUpload(event.target.files?.[0])} />
                          <Button type="button" variant="outline" size="sm" disabled={isUploadingImage} onClick={() => uploadInputRef.current?.click()}>
                            <ImagePlus className="mr-2 h-4 w-4" />{isUploadingImage ? "Cargando..." : field.value ? "Reemplazar foto" : "Cargar foto"}
                          </Button>
                          {field.value && <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange(null)}><X className="mr-2 h-4 w-4" />Quitar foto</Button>}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground"><Link href="/sign-in" className="font-medium text-primary underline">Inicia sesión</Link> para cargar una foto.</p>
                      )}
                      <p className="text-xs text-muted-foreground">JPG, PNG o WEBP. La foto se reduce sola al cargarla.</p>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                {(["cost", "price"] as const).map((name) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{name === "cost" ? "Costo ($)" : "Precio Venta ($)"}</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(["stock", "lowStockThreshold"] as const).map((name) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{name === "stock" ? "Stock Inicial" : "Alerta Bajo Stock"}</FormLabel>
                      <FormControl><Input type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </div>
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={createProduct.isPending || updateProduct.isPending || isUploadingImage}>Guardar</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    <AlertDialog open={!!productToDelete} onOpenChange={(open) => !open && setProductToDelete(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar {productToDelete?.name}?</AlertDialogTitle><AlertDialogDescription>Esta acción no se puede deshacer. Se eliminará el producto del inventario de forma permanente.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}