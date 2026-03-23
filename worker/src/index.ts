import { Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
export { WebSocketBroadcaster } from "./durable_object";

type Env = {
  DB: D1Database;
  INBOX_STATE: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

app.get("/api/emails", async (c) => {
  const url = new URL(c.req.url);
  const domain = url.searchParams.get("domain") || "";
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  let query = "SELECT id, message_id, from_address, to_address, to_domain, subject, text_preview, created_at FROM emails";
  const params: any[] = [];
  
  if (domain) {
    query += " WHERE to_domain = ?";
    params.push(domain);
  }
  
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  // Count
  let countQuery = "SELECT COUNT(*) as total FROM emails";
  const countParams: any[] = [];
  if (domain) {
    countQuery += " WHERE to_domain = ?";
    countParams.push(domain);
  }

  const db = c.env.DB;
  const [results, countResult] = await db.batch([
    db.prepare(query).bind(...params),
    db.prepare(countQuery).bind(...countParams)
  ]);

  return c.json({
    emails: results.results,
    total: countResult.results[0].total
  });
});

app.get("/api/emails/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first();
  if (!result) return c.notFound();
  return c.json(result);
});

app.post("/api/emails/delete", async (c) => {
  const { ids } = await c.req.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) return c.json({ success: false });

  const placeholders = ids.map(() => "?").join(",");
  const query = `DELETE FROM emails WHERE id IN (${placeholders})`;
  
  await c.env.DB.prepare(query).bind(...ids).run();
  
  // Also broadcast deletion event to update UI in real-time
  try {
    const docId = c.env.INBOX_STATE.idFromName("inbox");
    const obj = c.env.INBOX_STATE.get(docId);
    await obj.fetch(new Request("http://internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "DELETE_EMAILS", ids })
    }));
  } catch (err: any) {
    console.error("Failed to broadcast delete", err);
  }

  return c.json({ success: true });
});

app.get("/api/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const id = c.env.INBOX_STATE.idFromName("inbox");
  const obj = c.env.INBOX_STATE.get(id);
  // Reconstruct request correctly for Durable Object fetch
  return obj.fetch(c.req.raw);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },

  async email(message: any, env: Env, ctx: ExecutionContext) {
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
      const textPreview = textContent.slice(0, 150) + (textContent.length > 150 ? "..." : "");
      const createdAt = Date.now();

      await db.prepare(
        `INSERT INTO emails (id, message_id, from_address, to_address, to_domain, subject, text_preview, text_content, html_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, messageId, fromAddress, toAddress, toDomain, subject, textPreview, textContent, htmlContent, createdAt
      ).run();

      const docId = env.INBOX_STATE.idFromName("inbox");
      const obj = env.INBOX_STATE.get(docId);
      
      const payload = JSON.stringify({
        type: "NEW_EMAIL",
        email: {
           id, message_id: messageId, from_address: fromAddress, to_address: toAddress,
           to_domain: toDomain, subject, text_preview: textPreview, created_at: createdAt
        }
      });
      
      await obj.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        body: payload
      }));
    } catch (e: any) {
      console.error("Email processing failed", e);
    }
  }
};
