// Herramientas de terceros que se enlazan desde el análisis de cada activo.
// Solo enlaces: no se incrustan ni se copian datos. Logos oficiales en public/tools/<slug>.png
// (los suministra Jesús; nunca se dibujan). Sin logo se muestran las iniciales en `mark`.

export type ExternalTool = {
  slug: string;
  name: string;
  mark: string;
  logo?: string;
  summary: string;
  cta: string;
  href: (ticker: string) => string;
};

export const EL_FONDO: ExternalTool = {
  slug: "el-fondo",
  name: "El Fondo",
  mark: "EF",
  summary: "Simulador de portafolio con acciones, ETF y cripto. Proyecta tu cartera completa con un rango probable, sin registro.",
  cta: "Armar una cartera completa en El Fondo",
  href: () => "https://www.el-fondo.com/es/portfolio-simulator",
};

export const ETF_TOOLS: ExternalTool[] = [
  {
    slug: "etf-com",
    name: "ETF.com",
    mark: "ET",
    summary: "Comisión, tamaño, posiciones y volumen del fondo.",
    cta: "Ver ficha en ETF.com",
    href: (ticker) => `https://www.etf.com/${encodeURIComponent(ticker)}`,
  },
  {
    slug: "morningstar",
    name: "Morningstar",
    mark: "MS",
    summary: "Análisis independiente, costos y composición del fondo.",
    cta: "Buscar en Morningstar",
    href: (ticker) => `https://www.morningstar.com/search?query=${encodeURIComponent(ticker)}`,
  },
];
