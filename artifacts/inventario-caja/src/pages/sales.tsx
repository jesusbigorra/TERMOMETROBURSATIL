import { useState } from "react";
import { useListSales } from "@workspace/api-client-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Receipt, CreditCard, Banknote, Smartphone, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Sale } from "@workspace/api-client-react";

export default function SalesPage() {
  const { data: sales, isLoading } = useListSales();
  const [search, setSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const filteredSales = sales?.filter(s => 
    s.receiptNumber.toLowerCase().includes(search.toLowerCase()) ||
    s.paymentMethod.toLowerCase().includes(search.toLowerCase()) ||
    s.customerName.toLowerCase().includes(search.toLowerCase()) ||
    s.customerIdNumber.toLowerCase().includes(search.toLowerCase()) ||
    s.customerPhone.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const getPaymentIcon = (method: string) => {
    switch (method) {
      case "Efectivo": return <Banknote className="h-4 w-4" />;
      case "Tarjeta": return <CreditCard className="h-4 w-4" />;
      case "Transferencia": return <Receipt className="h-4 w-4" />;
      case "Pago móvil": return <Smartphone className="h-4 w-4" />;
      default: return <CreditCard className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Historial de Ventas</h1>
          <p className="text-sm text-muted-foreground">Consulta las transacciones registradas.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center space-x-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="Buscar por recibo, cliente, cédula o teléfono..."
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
                <TableHead>Fecha / Hora</TableHead>
                <TableHead>Recibo</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Artículos</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Cargando ventas...</TableCell>
                </TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No se encontraron ventas.</TableCell>
                </TableRow>
              ) : (
                filteredSales.map((sale) => (
                  <TableRow 
                    key={sale.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedSale(sale)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <span>{format(new Date(sale.createdAt), "dd/MM/yyyy HH:mm", { locale: es })}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono-numbers font-medium text-xs">
                      <Badge variant="outline">{sale.receiptNumber}</Badge>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{sale.customerName || "Sin identificar"}</p>
                      <p className="text-xs text-muted-foreground">{sale.customerIdNumber}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getPaymentIcon(sale.paymentMethod)}
                        <span>{sale.paymentMethod}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono-numbers">
                      {sale.items.reduce((acc, item) => acc + item.quantity, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono-numbers font-bold text-primary">
                      ${sale.total.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedSale} onOpenChange={(open) => !open && setSelectedSale(null)}>
        <DialogContent className="sm:max-w-[450px]">
          {selectedSale && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Detalle de Venta
                </DialogTitle>
                <CardDescription>
                  Recibo: <span className="font-mono-numbers text-foreground">{selectedSale.receiptNumber}</span>
                </CardDescription>
              </DialogHeader>
              
              <div className="py-4 space-y-4">
                <div className="flex justify-between items-center bg-muted/50 p-3 rounded-lg border">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="font-medium text-sm">{format(new Date(selectedSale.createdAt), "dd/MM/yyyy HH:mm")}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-muted-foreground">Pago</p>
                    <div className="flex items-center justify-end gap-1 font-medium text-sm">
                      {getPaymentIcon(selectedSale.paymentMethod)}
                      {selectedSale.paymentMethod}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cliente</p>
                  <p className="font-semibold">{selectedSale.customerName || "Sin identificar"}</p>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                    <span>Cédula: {selectedSale.customerIdNumber || "—"}</span>
                    <span>Teléfono: {selectedSale.customerPhone || "—"}</span>
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-3 text-sm">Artículos</h4>
                  <div className="space-y-3">
                    {selectedSale.items.map(item => (
                      <div key={item.id} className="flex justify-between text-sm items-center border-b pb-2 last:border-0">
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-muted-foreground font-mono-numbers text-xs">
                            {item.quantity} x ${item.unitPrice.toFixed(2)}
                          </p>
                        </div>
                        <span className="font-mono-numbers font-medium">${item.subtotal.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono-numbers">${selectedSale.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-1">
                    <span>Total</span>
                    <span className="font-mono-numbers text-primary">${selectedSale.total.toFixed(2)}</span>
                  </div>
                  {selectedSale.paymentMethod === 'Efectivo' && selectedSale.amountReceived && (
                    <>
                      <div className="flex justify-between text-sm pt-2">
                        <span className="text-muted-foreground">Recibido</span>
                        <span className="font-mono-numbers">${selectedSale.amountReceived.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cambio</span>
                        <span className="font-mono-numbers">${selectedSale.changeDue.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
