import { Hono } from "hono";
import PostalMime from "postal-mime";
export { WebSocketBroadcaster } from "./durable_object";

type Env = {
  DB: D1Database;
  INBOX_STATE: DurableObjectNamespace;
  API_KEY: string;
  ALLOWED_ORIGIN?: string;
};

type Variables = {
  authFailed?: boolean;
};

const AUTH_COOKIE_NAME = "infinite_inbox_auth";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const SECURE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

function parseCookieHeader(cookieHeader: string | undefined | null) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }

  return new Map(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
          return [part, ""] as const;
        }

        const name = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();

        try {
          return [name, decodeURIComponent(value)] as const;
        } catch {
          return [name, value] as const;
        }
      })
  );
}

function serializeCookie(name: string, value: string, secure: boolean) {
  const encodedValue = encodeURIComponent(value);
  return [
    `${name}=${encodedValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_MAX_AGE}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearCookie(name: string, secure: boolean) {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function getAllowedOrigin(c: Parameters<typeof app.fetch>[0] extends never ? never : any) {
  const configuredOrigin = c.env.ALLOWED_ORIGIN?.trim();
  if (!configuredOrigin) {
    return null;
  }

  return configuredOrigin;
}

function applySecurityHeaders(response: Response, c: Parameters<typeof app.fetch>[0] extends never ? never : any) {
  Object.entries(SECURE_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  const allowedOrigin = getAllowedOrigin(c);
  const requestOrigin = c.req.header("Origin");

  response.headers.append("Vary", "Origin");

  if (allowedOrigin && requestOrigin === allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }

  return response;
}

function jsonResponse(c: Parameters<typeof app.fetch>[0] extends never ? never : any, payload: unknown, status = 200) {
  return applySecurityHeaders(c.json(payload, status), c);
}

function textResponse(c: Parameters<typeof app.fetch>[0] extends never ? never : any, body: string, status = 200) {
  return applySecurityHeaders(new Response(body, { status }), c);
}

function isAuthorized(c: Parameters<typeof app.fetch>[0] extends never ? never : any) {
  const cookieHeader = c.req.header("Cookie");
  const cookies = parseCookieHeader(cookieHeader);
  const sessionKey = cookies.get(AUTH_COOKIE_NAME);

  if (!sessionKey) {
    return false;
  }

  return timingSafeEqual(sessionKey, c.env.API_KEY);
}

function requireAuth(c: Parameters<typeof app.fetch>[0] extends never ? never : any) {
  if (!isAuthorized(c)) {
    c.set("authFailed", true);
    return jsonResponse(c, { error: "Unauthorized" }, 401);
  }

  return null;
}

app.use("*", async (c, next) => {
  const requestOrigin = c.req.header("Origin");
  const allowedOrigin = getAllowedOrigin(c);

  if (requestOrigin && allowedOrigin && requestOrigin !== allowedOrigin) {
    return textResponse(c, "Forbidden", 403);
  }

  if (c.req.method === "OPTIONS") {
    return applySecurityHeaders(new Response(null, { status: 204 }), c);
  }

  await next();

  applySecurityHeaders(c.res, c);
});

app.post("/api/auth/login", async (c) => {
  let body: { apiKey?: unknown };

  try {
    body = await c.req.json();
  } catch {
    return jsonResponse(c, { error: "Invalid JSON payload" }, 400);
  }

  const submittedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!submittedKey) {
    return jsonResponse(c, { error: "API key is required" }, 400);
  }

  if (!timingSafeEqual(submittedKey, c.env.API_KEY)) {
    return jsonResponse(c, { error: "Invalid credentials" }, 401);
  }

  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", serializeCookie(AUTH_COOKIE_NAME, submittedKey, secure));
  return jsonResponse(c, { success: true, authenticated: true });
});

app.post("/api/auth/logout", (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", clearCookie(AUTH_COOKIE_NAME, secure));
  return jsonResponse(c, { success: true, authenticated: false });
});

app.get("/api/auth/session", (c) => {
  return jsonResponse(c, { authenticated: isAuthorized(c) });
});

app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) {
    await next();
    return;
  }

  const unauthorizedResponse = requireAuth(c);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  await next();
});

app.get("/api/emails", async (c) => {
  const url = new URL(c.req.url);
  const domain = (url.searchParams.get("domain") || "").trim().toLowerCase();
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const parsedOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  let query = "SELECT id, message_id, from_address, to_address, to_domain, subject, text_preview, created_at FROM emails";
  const params: string[] = [];

  if (domain) {
    query += " WHERE to_domain = ?";
    params.push(domain);
  }

  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

  let countQuery = "SELECT COUNT(*) as total FROM emails";
  const countParams: string[] = [];
  if (domain) {
    countQuery += " WHERE to_domain = ?";
    countParams.push(domain);
  }

  const db = c.env.DB;
  const [results, countResult] = await db.batch([
    db.prepare(query).bind(...params, limit, offset),
    db.prepare(countQuery).bind(...countParams),
  ]);
  const countRow = countResult.results[0] as { total?: number } | undefined;

  return jsonResponse(c, {
    emails: results.results,
    total: countRow?.total ?? 0,
  });
});

app.get("/api/emails/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first();
  if (!result) {
    return textResponse(c, "Not Found", 404);
  }
  return jsonResponse(c, result);
});

app.post("/api/emails/delete", async (c) => {
  let body: { ids?: unknown };

  try {
    body = await c.req.json();
  } catch {
    return jsonResponse(c, { success: false, error: "Invalid JSON payload" }, 400);
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (ids.length === 0) {
    return jsonResponse(c, { success: false, error: "No ids provided" }, 400);
  }

  const placeholders = ids.map(() => "?").join(",");
  const query = `DELETE FROM emails WHERE id IN (${placeholders})`;

  await c.env.DB.prepare(query).bind(...ids).run();

  try {
    const docId = c.env.INBOX_STATE.idFromName("inbox");
    const obj = c.env.INBOX_STATE.get(docId);
    await obj.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "DELETE_EMAILS", ids }),
    }));
  } catch (err: unknown) {
    console.error("Failed to broadcast delete", err);
  }

  return jsonResponse(c, { success: true });
});

app.get("/api/ws", async (c) => {
  const unauthorizedResponse = requireAuth(c);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return textResponse(c, "Expected Upgrade: websocket", 426);
  }

  const id = c.env.INBOX_STATE.idFromName("inbox");
  const obj = c.env.INBOX_STATE.get(id);
  return obj.fetch(c.req.raw);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env) {
    try {
      const db = env.DB;
      const rawBody = await new Response(message.raw).arrayBuffer();
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(rawBody);

      const id = crypto.randomUUID();
      const messageId = parsedEmail.messageId || crypto.randomUUID();
      const fromAddress = parsedEmail.from?.address || message.from;
      const toAddress = message.to;
      const toDomain = toAddress.split("@")[1] || "";
      const subject = parsedEmail.subject || "No Subject";
      const textContent = parsedEmail.text || "";
      const htmlContent = parsedEmail.html || "";
      const htmlPreview = htmlContent
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&/gi, "&")
        .replace(/</gi, "<")
        .replace(/>/gi, ">")
        .replace(/'|'/gi, "'")
        .replace(/"/gi, '"')
        .replace(/\s+/g, " ")
        .trim();
      const previewSource = textContent.trim() || htmlPreview;
      const textPreview = previewSource
        ? previewSource.slice(0, 150) + (previewSource.length > 150 ? "..." : "")
        : "(No preview available)";
      const createdAt = Date.now();

      await db.prepare(
        `INSERT INTO emails (id, message_id, from_address, to_address, to_domain, subject, text_preview, text_content, html_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        messageId,
        fromAddress,
        toAddress,
        toDomain,
        subject,
        textPreview,
        textContent,
        htmlContent,
        createdAt
      ).run();

      const docId = env.INBOX_STATE.idFromName("inbox");
      const obj = env.INBOX_STATE.get(docId);

      const payload = JSON.stringify({
        type: "NEW_EMAIL",
        email: {
          id,
          message_id: messageId,
          from_address: fromAddress,
          to_address: toAddress,
          to_domain: toDomain,
          subject,
          text_preview: textPreview,
          created_at: createdAt,
        },
      });

      await obj.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: payload,
      }));
    } catch (e: unknown) {
      console.error("Email processing failed", e);
    }
  },
};
