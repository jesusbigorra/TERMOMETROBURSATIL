import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProducts,
  useCreateSale,
  getListProductsQueryKey,
  getGetInventoryDashboardQueryKey,
  getGetInventoryActivityQueryKey,
  getListSalesQueryKey
} from "@workspace/api-client-react";
import { SaleInputPaymentMethod, type Product } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, Smartphone, ReceiptText, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type CartItem = {
  product: Product;
  quantity: number;
};

export default function SellPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useListProducts();
  const createSale = useCreateSale();

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<SaleInputPaymentMethod>("Efectivo");
  const [amountReceivedStr, setAmountReceivedStr] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const lowerSearch = search.toLowerCase();
    return products.filter(p => 
      p.stock > 0 && 
      (p.name.toLowerCase().includes(lowerSearch) || p.sku.toLowerCase().includes(lowerSearch))
    );
  }, [products, search]);

  const cartTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const amountReceived = parseFloat(amountReceivedStr);
  const changeDue = amountReceived > cartTotal ? amountReceived - cartTotal : 0;

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) {
          toast({ title: "Stock insuficiente", description: `Solo hay ${product.stock} disponibles.`, variant: "destructive" });
          return prev;
        }
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQ = item.quantity + delta;
        if (newQ > item.product.stock) {
          toast({ title: "Stock insuficiente", variant: "destructive" });
          return item;
        }
        return { ...item, quantity: Math.max(0, newQ) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    if (!customerName.trim() || !customerIdNumber.trim() || !customerPhone.trim()) {
      toast({ title: "Faltan datos del cliente", description: "Indica nombre, cédula y teléfono.", variant: "destructive" });
      return;
    }
    
    if (paymentMethod === "Efectivo") {
      if (isNaN(amountReceived) || amountReceived < cartTotal) {
        toast({ title: "Monto inválido", description: "El monto recibido debe ser mayor o igual al total.", variant: "destructive" });
        return;
      }
    }

    createSale.mutate({
      data: {
        paymentMethod,
        amountReceived: paymentMethod === "Efectivo" ? amountReceived : null,
        customerName: customerName.trim(),
        customerIdNumber: customerIdNumber.trim(),
        customerPhone: customerPhone.trim(),
        items: cart.map(item => ({ productId: item.product.id, quantity: item.quantity }))
      }
    }, {
      onSuccess: () => {
        toast({ title: "Venta registrada", description: "La venta se ha procesado correctamente." });
        setCart([]);
        setAmountReceivedStr("");
        setCustomerName("");
        setCustomerIdNumber("");
        setCustomerPhone("");
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInventoryDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetInventoryActivityQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudo registrar la venta.", variant: "destructive" });
      }
    });
  };

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col md:flex-row gap-6">
      
      {/* Product Selection Panel */}
      <div className="flex-1 flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b bg-muted/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar productos para vender..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-12 text-lg shadow-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {isLoading ? (
              <div className="col-span-full text-center text-muted-foreground py-8">Cargando catálogo...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-full text-center text-muted-foreground py-8">No hay productos en stock.</div>
            ) : (
              filteredProducts.map(product => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="text-left bg-background border rounded-lg p-3 hover:border-primary hover:shadow-md transition-all active:scale-95 flex flex-col h-full"
                >
                  <div className="mb-3 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md bg-muted/50">
                    {product.imagePath ? <img src={`/api/storage${product.imagePath}`} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-8 w-8 text-muted-foreground/40" />}
                  </div>
                  <span className="font-mono-numbers text-xs text-muted-foreground mb-1">{product.sku}</span>
                  <span className="font-medium leading-tight mb-2 flex-1">{product.name}</span>
                  <span className="mb-2 line-clamp-2 text-xs leading-snug text-muted-foreground">{product.description}</span>
                  <div className="flex justify-between items-end w-full mt-auto pt-2">
                    <Badge variant="secondary" className="font-mono-numbers text-xs">{product.stock} disp.</Badge>
                    <span className="font-bold text-primary font-mono-numbers">${product.price.toFixed(2)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Cart & Checkout Panel */}
      <div className="w-full md:w-[400px] flex flex-col bg-card border rounded-xl overflow-hidden shadow-sm shrink-0">
        <div className="p-4 border-b bg-sidebar text-sidebar-foreground flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Ticket Actual
          </h2>
          <Badge variant="secondary" className="bg-sidebar-accent text-sidebar-accent-foreground border-none">
            {cart.reduce((s, i) => s + i.quantity, 0)} ítems
          </Badge>
        </div>
        
        <div className="flex-1 overflow-auto p-0">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 p-8 text-center space-y-3">
              <ReceiptText className="h-16 w-16 mb-2" />
              <p>El ticket está vacío.</p>
              <p className="text-sm">Selecciona productos del catálogo para comenzar.</p>
            </div>
          ) : (
            <div className="divide-y">
              {cart.map(item => (
                <div key={item.product.id} className="p-4 flex gap-3 items-center group">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate leading-tight">{item.product.name}</p>
                    <p className="text-sm text-muted-foreground font-mono-numbers">${item.product.price.toFixed(2)} c/u</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-bold font-mono-numbers">${(item.product.price * item.quantity).toFixed(2)}</p>
                    <div className="flex items-center gap-1 border rounded-md p-0.5 bg-background">
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-muted-foreground" onClick={() => updateQuantity(item.product.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center font-medium font-mono-numbers text-sm">{item.quantity}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-muted-foreground" onClick={() => updateQuantity(item.product.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-muted/30 space-y-4">
          <div className="space-y-2 rounded-lg border bg-background p-3">
            <p className="text-sm font-semibold">Datos del cliente</p>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre y apellido" maxLength={120} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={customerIdNumber} onChange={(e) => setCustomerIdNumber(e.target.value)} placeholder="Cédula" maxLength={40} />
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Teléfono" type="tel" maxLength={40} />
            </div>
          </div>
          <div className="flex justify-between items-center text-lg">
            <span className="font-medium">Total a Pagar</span>
            <span className="text-2xl font-bold font-mono-numbers text-primary">${cartTotal.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { id: "Efectivo", icon: Banknote, label: "Efectivo" },
              { id: "Tarjeta", icon: CreditCard, label: "Tarjeta" },
              { id: "Transferencia", icon: ReceiptText, label: "Transf." },
              { id: "Pago móvil", icon: Smartphone, label: "P. Móvil" }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => {
                  setPaymentMethod(m.id as SaleInputPaymentMethod);
                  if (m.id !== "Efectivo") setAmountReceivedStr("");
                }}
                className={`flex flex-col items-center justify-center p-2 rounded-lg border text-xs gap-1 transition-all ${
                  paymentMethod === m.id ? 'bg-primary/10 border-primary text-primary font-medium shadow-sm' : 'bg-background hover:bg-muted text-muted-foreground'
                }`}
              >
                <m.icon className="h-5 w-5" />
                <span className="truncate w-full text-center">{m.label}</span>
              </button>
            ))}
          </div>

          {paymentMethod === "Efectivo" && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Recibido</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono-numbers">$</span>
                  <Input 
                    type="number" 
                    step="0.01" 
                    min={cartTotal}
                    className="pl-7 font-mono-numbers font-medium text-lg h-12"
                    value={amountReceivedStr}
                    onChange={e => setAmountReceivedStr(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cambio</label>
                <div className="h-12 border rounded-md bg-muted flex items-center px-3 font-mono-numbers font-bold text-lg text-primary">
                  ${changeDue > 0 ? changeDue.toFixed(2) : "0.00"}
                </div>
              </div>
            </div>
          )}

          <Button 
            size="lg" 
            className="w-full h-14 text-lg font-bold shadow-md"
            disabled={cart.length === 0 || createSale.isPending || !customerName.trim() || !customerIdNumber.trim() || !customerPhone.trim() || (paymentMethod === "Efectivo" && (isNaN(amountReceived) || amountReceived < cartTotal))}
            onClick={handleCheckout}
          >
            {createSale.isPending ? "Procesando..." : `Cobrar $${cartTotal.toFixed(2)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
