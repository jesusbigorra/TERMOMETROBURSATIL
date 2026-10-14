// Directorio de brokers para la página /brokers.
// Cada dato se tomó de la página oficial del broker (ver `sources`) y se revisó en REVIEWED_ON.
// Los esquemas de protección cambian: al actualizar un broker, vuelve a leer su fuente y cambia la fecha.
//
// Logos: las marcas son de cada broker. Descarga el logo desde su página de prensa o de marca,
// guárdalo en `public/brokers/` (por ejemplo `public/brokers/etoro.svg`) y pon `logo: "/brokers/etoro.svg"`.
// Mientras `logo` no exista, la tarjeta muestra las iniciales del broker.

export const REVIEWED_ON = "14 de octubre de 2026";

export type BrokerRegion = "EE. UU." | "Europa" | "Global";

export type Broker = {
  slug: string;
  name: string;
  /** Iniciales que se muestran mientras no haya logo. */
  mark: string;
  /** Frase corta de qué es, en palabras neutrales. */
  summary: string;
  regions: BrokerRegion[];
  /** Dónde opera y bajo qué entidad. */
  zone: string;
  /** Reguladores y membresías que la propia página del broker declara. */
  regulators: string[];
  /** Qué resguarda el capital del cliente y hasta cuánto. */
  protection: string[];
  /** Limitaciones importantes que el broker o el esquema de protección declaran. */
  caveat: string;
  website: string;
  login?: { label: string; url: string };
  logo?: string;
  sources: { label: string; url: string }[];
};

export const BROKERS: Broker[] = [
  {
    slug: "folionet",
    mark: "FO",
    logo: "/brokers/folionet.png",
    name: "Folionet",
    summary: "Corretaje de acciones, ETF y bonos del Tesoro de EE. UU., con cuentas asesoradas.",
    regions: ["EE. UU."],
    zone: "Estados Unidos. Opera Folionet Financial LLC (corretaje) y Folionet Advisers LLC (asesoría), ambas subsidiarias de Folionet Holdings Inc.",
    regulators: [
      "SEC: corredor-agente registrado (Folionet Financial LLC)",
      "FINRA: miembro",
      "Asesor de inversión registrado en Florida (Folionet Advisers LLC)",
    ],
    protection: [
      "SIPC: hasta US$500.000 por cliente, con un máximo de US$250.000 en efectivo.",
      "Operaciones compensadas por Apex Clearing Corporation y StoneX Financial Inc.",
    ],
    caveat: "Sus productos no tienen seguro FDIC ni garantía bancaria y pueden perder valor.",
    website: "https://www.folionet.com/",
    sources: [{ label: "Folionet", url: "https://www.folionet.com/" }],
  },
  {
    slug: "etoro",
    mark: "eT",
    logo: "/brokers/etoro.png",
    name: "eToro",
    summary: "Plataforma de inversión social con acciones, ETF y criptoactivos, organizada en entidades por región.",
    regions: ["Global", "Europa", "EE. UU."],
    zone: "Global. La entidad que te atiende depende de tu región: Reino Unido, Europa (Chipre), Australia, Estados Unidos, Singapur, Emiratos y otras.",
    regulators: [
      "FCA (Reino Unido): etoro (UK) Ltd",
      "CySEC (Chipre, UE): etoro (Europe) Ltd",
      "ASIC (Australia): etoro AUS Capital Limited",
      "SEC y FINRA (EE. UU.): etoro USA Securities Inc.",
      "MAS (Singapur), ADGM FSRA (Emiratos) y FSAS (Seychelles) para sus entidades locales",
    ],
    protection: [
      "Reino Unido: FSCS, hasta £85.000 por persona.",
      "Unión Europea: Fondo de Compensación de Inversores de Chipre (ICF), hasta €20.000.",
      "Dinero en bancos socios del EEE: puede tener la garantía de depósitos local, a menudo hasta €100.000.",
    ],
    caveat: "Los criptoactivos no están cubiertos por el FSCS ni por el ICF. La protección que aplica depende de la entidad eToro que te corresponda.",
    website: "https://www.etoro.com/en-us/",
    sources: [{ label: "eToro: regulación y licencias", url: "https://www.etoro.com/customer-service/regulation-license/" }],
  },
  {
    slug: "interactive-brokers",
    mark: "IB",
    name: "Interactive Brokers",
    summary: "Acceso a mercados globales de acciones, opciones, futuros, divisas y bonos.",
    regions: ["Global", "EE. UU.", "Europa"],
    zone: "Global, con entidades en EE. UU., Reino Unido, Irlanda, Canadá, Australia, Hong Kong, India, Japón y Singapur.",
    regulators: [
      "SEC y CFTC; miembro de FINRA, NYSE y SIPC (Interactive Brokers LLC, EE. UU.)",
      "FCA (Interactive Brokers U.K. Limited)",
      "Banco Central de Irlanda (Interactive Brokers Ireland Limited)",
      "ASIC, SFC de Hong Kong, SEBI, MAS y CIRO para sus entidades locales",
    ],
    protection: [
      "EE. UU. (Interactive Brokers LLC): SIPC hasta US$500.000, con US$250.000 en efectivo.",
      "Cobertura adicional de Lloyd's de Londres: hasta US$30 millones por cuenta (US$900.000 en efectivo), con tope agregado de US$150 millones.",
      "Irlanda: esquema irlandés de compensación de inversores, 90% de la pérdida hasta €20.000 por inversor.",
    ],
    caveat: "SIPC no cubre futuros ni opciones sobre futuros, y ninguna de estas protecciones cubre pérdidas por movimientos del mercado.",
    website: "https://www.interactivebrokers.com/",
    sources: [
      { label: "Interactive Brokers: protección al cliente", url: "https://www.interactivebrokers.com/en/general/security-investor-protection.php" },
      { label: "Interactive Brokers Irlanda: protección al cliente", url: "https://interactivebrokers.ie/en/general/security-investor-protection.php" },
    ],
  },
  {
    slug: "robinhood",
    mark: "RH",
    name: "Robinhood",
    summary: "Corretaje de acciones y ETF con opción de criptoactivos.",
    regions: ["EE. UU."],
    zone: "Estados Unidos. Robinhood Financial LLC ofrece el corretaje y Robinhood Securities, LLC presta servicios de compensación.",
    regulators: [
      "Corredor-agente registrado y miembro de SIPC (Robinhood Financial LLC y Robinhood Securities, LLC)",
      "Miembro de FINRA (Robinhood Financial LLC)",
    ],
    protection: [
      "SIPC: hasta US$500.000 entre valores y efectivo, con US$250.000 en efectivo.",
      "Seguro suplementario que actúa cuando se agota SIPC: tope agregado de US$1.000 millones, y por cliente hasta US$50 millones en valores y US$1,9 millones en efectivo.",
    ],
    caveat: "Las criptomonedas (Robinhood Crypto) y los futuros no están protegidos por SIPC. Ninguna cobertura cubre pérdidas por movimientos del mercado.",
    website: "https://robinhood.com/",
    sources: [
      { label: "Robinhood: protección de cuenta con SIPC", url: "https://robinhood.com/us/en/support/articles/Account-protection-with-SIPC/?region=US" },
      { label: "Robinhood: información legal", url: "https://robinhood.com/us/en/about/legal/" },
    ],
  },
  {
    slug: "forex-com",
    mark: "FX",
    name: "FOREX.com",
    summary: "Intercambio de divisas y futuros, operado por el grupo StoneX.",
    regions: ["EE. UU."],
    zone: "Estados Unidos (GAIN Capital Group LLC, que opera como FOREX.com, subsidiaria de StoneX Group Inc.). El grupo tiene entidades reguladas en otras regiones.",
    regulators: [
      "CFTC: comerciante de comisiones de futuros (FCM) y distribuidor minorista de divisas (RFED)",
      "NFA: miembro desde 2004 (n.º 0339826)",
    ],
    protection: [
      "Los fondos de los clientes se mantienen separados de los fondos operativos de la empresa y repartidos en una red de bancos y brokers custodios.",
      "Los activos y obligaciones de los clientes se reportan a la NFA a diario.",
    ],
    caveat: "Su página oficial no menciona seguro SIPC ni seguro de depósitos. Divisas y futuros son productos de alto riesgo.",
    website: "https://www.forex.com/en-us/",
    login: { label: "Iniciar sesión", url: "https://www.forex.com/en-us/account-login/" },
    sources: [{ label: "FOREX.com: regulación", url: "https://forex.com/en-us/about-us/regulation" }],
  },
  {
    slug: "trade-republic",
    mark: "TR",
    name: "Trade Republic",
    summary: "Banco digital europeo para invertir en acciones, ETF y planes de ahorro.",
    regions: ["Europa"],
    zone: "Europa. Contrata con Trade Republic Bank GmbH, con sede en Alemania.",
    regulators: [
      "BaFin (Alemania) y Bundesbank",
      "Supervisión prudencial del BCE, desde la licencia bancaria de diciembre de 2023",
    ],
    protection: [
      "Efectivo: garantía de depósitos alemana (Entschädigungseinrichtung deutscher Banken), hasta €100.000 por inversor en cada banco socio.",
      "Valores: custodiados de forma segregada del patrimonio de la empresa.",
      "Respaldo del esquema alemán de compensación de inversores: 90% de la pérdida hasta €20.000.",
    ],
    caveat: "El efectivo que supere el límite puede pasar a fondos de liquidez, que no tienen garantía de depósitos.",
    website: "https://traderepublic.com/en-de",
    sources: [
      { label: "Trade Republic: cómo se protege tu dinero", url: "https://support.traderepublic.com/en-ee/743-How-is-my-money-protected" },
      { label: "Trade Republic: hoja informativa del depositante", url: "https://assets.traderepublic.com/assets/files/TradeRepublic_DepositorInformationSheet.pdf" },
      { label: "EU Personal Finance: ¿es seguro Trade Republic?", url: "https://www.eupersonalfinance.eu/articles/is-trade-republic-safe" },
    ],
  },
];
