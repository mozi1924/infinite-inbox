export class WebSocketBroadcaster {
  state: DurableObjectState;
  sessions: Set<WebSocket>;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.sessions = new Set();
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const data = await request.text();
      this.broadcast(data);
      return new Response("OK");
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.state.acceptWebSocket(server);
      this.sessions.add(server);

      try {
        server.send(JSON.stringify({ type: "CONNECTED" }));
      } catch (error) {
        this.sessions.delete(server);
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);

    if (text === "ping") {
      try {
        ws.send("pong");
      } catch (error) {
        this.sessions.delete(ws);
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    this.sessions.delete(ws);
  }

  webSocketError(ws: WebSocket, error: any) {
    this.sessions.delete(ws);
  }

  broadcast(data: string) {
    for (const session of this.sessions) {
      try {
        session.send(data);
      } catch (err) {
        this.sessions.delete(session);
      }
    }
  }
}
