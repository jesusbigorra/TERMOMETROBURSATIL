// Calendario de publicaciones que mueven los mercados de EE. UU.
// Todas las fechas salen de los calendarios oficiales (ver `sources`) y se revisaron en REVIEWED_ON.
// Para actualizarlo: añade eventos nuevos cuando la Fed, el BLS o el BEA publiquen su calendario siguiente.
// Importante: son fechas, no pronósticos. Los valores de consenso (previsto contra real) no se incluyen.

export const CALENDAR_REVIEWED_ON = "14 de octubre de 2026";

export type EventKind = "fed" | "empleo" | "inflacion" | "pib" | "consumo";
export type EconomicEvent = {
  /** Fecha local de EE. UU. en formato AAAA-MM-DD. */
  date: string;
  /** Hora en Nueva York si la fuente la publica. */
  time?: string;
  kind: EventKind;
  importance: "alta" | "media";
  title: string;
  detail: string;
};

export const KIND_LABEL: Record<EventKind, string> = {
  fed: "Fed",
  empleo: "Empleo",
  inflacion: "Inflación",
  pib: "PIB",
  consumo: "Consumo",
};

export const CALENDAR_SOURCES = [
  { label: "Reserva Federal: calendario FOMC", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { label: "BLS: publicación del IPC", url: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { label: "BLS: informe de empleo", url: "https://www.bls.gov/schedule/news_release/empsit.htm" },
  { label: "BEA: calendario de publicaciones", url: "https://www.bea.gov/news/schedule" },
];

const ET = "8:30 a. m. ET";

export const ECONOMIC_EVENTS: EconomicEvent[] = [
  { date: "2026-10-28", kind: "fed", importance: "alta", title: "Decisión de tasas de la Fed", detail: "Reunión del FOMC, 27 y 28 de octubre. El día de la decisión es el segundo." },
  { date: "2026-10-29", time: ET, kind: "pib", importance: "media", title: "PIB del 3.er trimestre (adelantado)", detail: "Primera estimación del BEA." },
  { date: "2026-10-29", time: ET, kind: "consumo", importance: "media", title: "Ingresos y gastos personales de septiembre", detail: "Incluye el índice PCE, la medida de inflación que sigue la Fed." },
  { date: "2026-11-06", time: ET, kind: "empleo", importance: "alta", title: "Informe de empleo de octubre", detail: "Nóminas no agrícolas y tasa de desempleo (BLS)." },
  { date: "2026-11-10", time: ET, kind: "inflacion", importance: "alta", title: "IPC de octubre", detail: "Índice de precios al consumidor (BLS)." },
  { date: "2026-11-25", time: ET, kind: "pib", importance: "media", title: "PIB del 3.er trimestre (segunda estimación)", detail: "Incluye beneficios corporativos (BEA)." },
  { date: "2026-11-25", time: ET, kind: "consumo", importance: "media", title: "Ingresos y gastos personales de octubre", detail: "Incluye el índice PCE." },
  { date: "2026-12-04", time: ET, kind: "empleo", importance: "alta", title: "Informe de empleo de noviembre", detail: "Nóminas no agrícolas y tasa de desempleo (BLS)." },
  { date: "2026-12-09", kind: "fed", importance: "alta", title: "Decisión de tasas de la Fed", detail: "Reunión del FOMC, 8 y 9 de diciembre, con proyecciones económicas." },
  { date: "2026-12-10", time: ET, kind: "inflacion", importance: "alta", title: "IPC de noviembre", detail: "Índice de precios al consumidor (BLS)." },
  { date: "2026-12-23", time: ET, kind: "pib", importance: "media", title: "PIB del 3.er trimestre (tercera estimación)", detail: "Tercera estimación del BEA." },
  { date: "2026-12-23", time: ET, kind: "consumo", importance: "media", title: "Ingresos y gastos personales de noviembre", detail: "Incluye el índice PCE." },
  { date: "2027-01-08", time: ET, kind: "empleo", importance: "alta", title: "Informe de empleo de diciembre", detail: "Nóminas no agrícolas y tasa de desempleo (BLS)." },
  { date: "2027-01-13", time: ET, kind: "inflacion", importance: "alta", title: "IPC de diciembre", detail: "Índice de precios al consumidor (BLS)." },
  { date: "2027-01-27", kind: "fed", importance: "alta", title: "Decisión de tasas de la Fed", detail: "Reunión del FOMC, 26 y 27 de enero." },
  { date: "2027-02-05", time: ET, kind: "empleo", importance: "alta", title: "Informe de empleo de enero", detail: "Nóminas no agrícolas y tasa de desempleo (BLS)." },
  { date: "2027-02-11", time: ET, kind: "inflacion", importance: "alta", title: "IPC de enero", detail: "Índice de precios al consumidor (BLS)." },
  { date: "2027-03-05", time: ET, kind: "empleo", importance: "alta", title: "Informe de empleo de febrero", detail: "Nóminas no agrícolas y tasa de desempleo (BLS)." },
  { date: "2027-03-10", time: ET, kind: "inflacion", importance: "alta", title: "IPC de febrero", detail: "Índice de precios al consumidor (BLS)." },
  { date: "2027-03-17", kind: "fed", importance: "alta", title: "Decisión de tasas de la Fed", detail: "Reunión del FOMC, 16 y 17 de marzo, con proyecciones económicas." },
];
