import { Route, Switch, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { ClerkProvider, SignIn, SignUp, Show } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

import DashboardPage from "@/pages/dashboard";
import ProductsPage from "@/pages/products";
import SellPage from "@/pages/sell";
import SalesPage from "@/pages/sales";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route>
        <Shell>
          <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/productos" component={ProductsPage} />
        <Route path="/vender"><Protected><SellPage /></Protected></Route>
        <Route path="/ventas"><Protected><SalesPage /></Protected></Route>
        <Route component={NotFound} />
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(to.replace(basePath, "") || "/")}
      routerReplace={(to) => setLocation(to.replace(basePath, "") || "/", { replace: true })}
      appearance={{ options: { logoImageUrl: `${window.location.origin}${basePath}/numini-mark.svg`, logoLinkUrl: basePath || "/" }, variables: { colorPrimary: "hsl(226 71% 40%)", colorBackground: "hsl(0 0% 100%)", colorForeground: "hsl(222 47% 11%)", fontFamily: "Inter" } }}
      localization={{ signIn: { start: { title: "Accede a NUMINI SHOP", subtitle: "Entra para administrar fotos de productos" } }, signUp: { start: { title: "Crea tu acceso", subtitle: "Protege la gestión de tu tienda" } } }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ErrorBoundary><Router /></ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}

export default App;
