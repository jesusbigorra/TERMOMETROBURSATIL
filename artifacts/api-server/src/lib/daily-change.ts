// Variación del día en %: precio actual frente al último cierre de una sesión anterior.
// Yahoo devuelve en meta.chartPreviousClose el cierre previo al INICIO del rango pedido
// (con range=1y, el de hace un año), así que no sirve como "cierre de ayer".
export function dailyChangePercent(latest: number, dates: string[], closes: number[], marketTime: number): number | null {
  if (!closes.length || dates.length !== closes.length) return null;
  const marketDay = Number.isFinite(marketTime) ? new Date(marketTime * 1000).toISOString().slice(0, 10) : null;
  // Si la última barra es la de hoy se compara con la anterior; si no, con la última barra.
  const lastIsToday = marketDay !== null && dates[dates.length - 1] === marketDay;
  const previous = lastIsToday ? closes[closes.length - 2] : closes[closes.length - 1];
  if (typeof previous !== "number" || !Number.isFinite(previous) || previous <= 0) return null;
  return Number((((latest - previous) / previous) * 100).toFixed(2));
}
