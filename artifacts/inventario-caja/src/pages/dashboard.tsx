import { useGetInventoryDashboard, useGetInventoryActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, DollarSign, TrendingUp, AlertTriangle, Activity, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function DashboardPage() {
  const { data: dashboard, isLoading: isDashboardLoading } = useGetInventoryDashboard();
  const { data: activity, isLoading: isActivityLoading } = useGetInventoryActivity();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Ventas de hoy"
          value={isDashboardLoading ? null : `$${dashboard?.salesToday.toFixed(2)}`}
          icon={DollarSign}
          description="Total cobrado hoy"
        />
        <MetricCard
          title="Ganancia de hoy"
          value={isDashboardLoading ? null : `$${dashboard?.profitToday.toFixed(2)}`}
          icon={TrendingUp}
          description="Margen bruto de hoy"
        />
        <MetricCard
          title="Productos en Stock"
          value={isDashboardLoading ? null : dashboard?.totalUnits.toString() ?? null}
          icon={Package}
          description={`De ${dashboard?.totalProducts} productos únicos`}
        />
        <MetricCard
          title="Alertas de Stock"
          value={isDashboardLoading ? null : dashboard?.lowStockProducts.toString() ?? null}
          icon={AlertTriangle}
          description="Productos con bajo inventario"
          alert={dashboard?.lowStockProducts ? dashboard.lowStockProducts > 0 : false}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-1 lg:col-span-4 flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              Actividad Reciente
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {isActivityLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-4">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-center gap-4 border-b border-border/50 pb-4 last:border-0 last:pb-0">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      item.kind === 'sale' ? 'bg-primary/10 text-primary' :
                      item.kind === 'stock_low' ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {item.kind === 'sale' ? <DollarSign className="h-5 w-5" /> :
                       item.kind === 'stock_low' ? <AlertTriangle className="h-5 w-5" /> :
                       <Package className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-none text-foreground truncate">{item.title}</p>
                      <p className="text-sm text-muted-foreground truncate">{item.detail}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {item.amount !== null && (
                        <p className="text-sm font-semibold font-mono-numbers text-foreground">
                          {item.kind === 'sale' ? '+' : ''}${item.amount.toFixed(2)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(item.createdAt), "HH:mm", { locale: es })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground py-8">
                <Activity className="h-12 w-12 mb-2 opacity-20" />
                <p>No hay actividad reciente registrada.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              Desglose de Caja
            </CardTitle>
            <CardDescription>Cobros del día por método de pago</CardDescription>
          </CardHeader>
          <CardContent>
            {isDashboardLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : dashboard?.paymentTotals && dashboard.paymentTotals.length > 0 ? (
              <div className="space-y-4">
                {dashboard.paymentTotals.map((pt) => (
                  <div key={pt.method} className="flex items-center justify-between">
                    <span className="text-sm font-medium">{pt.method}</span>
                    <span className="text-sm font-semibold font-mono-numbers text-foreground">
                      ${pt.total.toFixed(2)}
                    </span>
                  </div>
                ))}
                <div className="pt-4 mt-4 border-t flex items-center justify-between font-bold text-lg">
                  <span>Total en Caja</span>
                  <span className="font-mono-numbers">${dashboard.salesToday.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                No hay ventas hoy.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, description, alert }: { title: string, value: string | null, icon: any, description: string, alert?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${alert ? 'text-destructive' : 'text-muted-foreground'}`} />
      </CardHeader>
      <CardContent>
        {value === null ? (
          <Skeleton className="h-8 w-[100px] mb-1" />
        ) : (
          <div className={`text-2xl font-bold font-mono-numbers ${alert ? 'text-destructive' : 'text-foreground'}`}>
            {value}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}
