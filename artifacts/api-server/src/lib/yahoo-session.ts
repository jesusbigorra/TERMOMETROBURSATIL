// Yahoo Finance requires a session cookie plus a "crumb" token for the
// quoteSummary / quote endpoints (fundamentals). The chart endpoint does not.
// We obtain both once and reuse them until they expire or get rejected.
import { logger } from "./logger";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SESSION_TTL_MS = 60 * 60 * 1000;

type Session = { cookie: string; crumb: string; expiresAt: number };
let session: Session | null = null;
let pending: Promise<Session> | null = null;
let failedAt = 0;
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;

function extractCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  return raw
    .flatMap((line) => line.split(/,(?=\s*[A-Za-z0-9_]+=)/))
    .map((line) => line.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair && pair.includes("=")))
    .join("; ");
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function cookieFrom(url: string): Promise<string> {
  return withTimeout(7000, async (signal) => {
    const response = await fetch(url, { headers: BROWSER_HEADERS, redirect: "manual", signal });
    return extractCookies(response);
  });
}

async function crumbFor(cookie: string): Promise<string | null> {
  for (const host of ["query2", "query1"]) {
    const crumb = await withTimeout(7000, async (signal) => {
      const response = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
        headers: { ...BROWSER_HEADERS, Accept: "*/*", Cookie: cookie, Referer: "https://finance.yahoo.com/" },
        signal,
      });
      return response.ok ? (await response.text()).trim() : null;
    }).catch(() => null);
    if (crumb && !crumb.includes("<") && crumb.length <= 64) return crumb;
  }
  return null;
}

async function createSession(): Promise<Session> {
  // Try the lightweight consent cookie first, then the full finance.yahoo.com cookie set.
  for (const source of ["https://fc.yahoo.com/", "https://finance.yahoo.com/quote/SPY/"]) {
    const cookie = await cookieFrom(source).catch(() => "");
    if (!cookie) continue;
    const crumb = await crumbFor(cookie);
    if (crumb) return { cookie, crumb, expiresAt: Date.now() + SESSION_TTL_MS };
  }
  throw new Error("Yahoo no entregó una sesión válida (crumb)");
}

export async function getYahooSession(force = false): Promise<Session> {
  if (!force && session && session.expiresAt > Date.now()) return session;
  // Yahoo often blocks cloud IPs; do not hammer it after a failure.
  if (Date.now() - failedAt < FAILURE_BACKOFF_MS) throw new Error("Sesión de Yahoo en pausa tras un rechazo reciente");
  if (!pending) {
    pending = createSession()
      .then((created) => {
        session = created;
        return created;
      })
      .catch((error) => {
        failedAt = Date.now();
        throw error;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

// Fetch a Yahoo endpoint that needs the crumb. Retries once with a fresh session on 401/403.
export async function fetchYahooAuthed(url: string, timeoutMs = 8000): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await getYahooSession(attempt > 0);
    const separator = url.includes("?") ? "&" : "?";
    const response = await withTimeout(timeoutMs, (signal) =>
      fetch(`${url}${separator}crumb=${encodeURIComponent(current.crumb)}`, {
        headers: { "User-Agent": USER_AGENT, Cookie: current.cookie, Accept: "application/json" },
        signal,
      }),
    );
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      logger.warn({ status: response.status }, "Yahoo session rejected, renewing crumb");
      continue;
    }
    if (!response.ok) throw new Error(`Yahoo respondió ${response.status}`);
    return response.json();
  }
  throw new Error("Yahoo rechazó la sesión");
}

export const YAHOO_USER_AGENT = USER_AGENT;
