import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, Package, ShoppingCart, Receipt, Store } from "lucide-react";
import { Show, UserButton } from "@clerk/react";
import { Button } from "@/components/ui/button";

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { label: "Resumen", icon: LayoutDashboard, href: "/" },
    { label: "Vender", icon: ShoppingCart, href: "/vender" },
    { label: "Productos", icon: Package, href: "/productos" },
    { label: "Ventas", icon: Receipt, href: "/ventas" },
  ];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar variant="sidebar" collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border py-4 px-4 h-[60px] flex items-center justify-center">
            <div className="flex items-center gap-3 font-semibold text-sidebar-foreground w-full overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                <Store className="h-4 w-4" />
              </div>
              <span className="truncate whitespace-nowrap">NUMINI SHOP</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent className="py-4">
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton 
                          asChild 
                          isActive={isActive} 
                          tooltip={item.label}
                          className="font-medium"
                        >
                          <Link href={item.href} className="flex items-center gap-3">
                            <item.icon className="h-5 w-5" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4">
             <div className="text-xs text-sidebar-foreground/50 truncate font-medium">
               NUMINI SHOP · MVP 1.0
             </div>
          </SidebarFooter>
        </Sidebar>
        
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-[60px] border-b bg-card flex items-center px-4 md:px-6 shrink-0 z-10 sticky top-0">
            <SidebarTrigger className="-ml-2 mr-4 md:hidden" />
            <h1 className="text-lg font-semibold tracking-tight">
              {navItems.find(i => i.href === location)?.label || "Panel"}
            </h1>
            <div className="ml-auto flex items-center">
              <Show when="signed-out">
                <Button asChild size="sm"><Link href="/sign-in">Iniciar sesión</Link></Button>
              </Show>
              <Show when="signed-in"><UserButton /></Show>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
