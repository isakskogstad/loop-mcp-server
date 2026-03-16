import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";

import { registerTools as registerSupabaseTools } from "./tools/supabase.js";
import { registerPineconeTools } from "./tools/pinecone.js";
import { registerSlackTools } from "./tools/slack.js";
import { registerWebTools } from "./tools/web.js";

// --- Validate required env vars ---

const REQUIRED_ENV_VARS = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"] as const;

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const LOOP_MCP_API_KEY = process.env.LOOP_MCP_API_KEY;

// --- Create MCP server and register tools ---

function createServer(): McpServer {
  const server = new McpServer({
    name: "loop-mcp-server",
    version: "1.0.0",
  });

  registerSupabaseTools(server);
  registerPineconeTools(server);
  registerSlackTools(server);
  registerWebTools(server);

  return server;
}

// --- Auth middleware ---

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!LOOP_MCP_API_KEY) {
    // No API key configured — skip auth
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== LOOP_MCP_API_KEY) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  next();
}

// --- Express app ---

const app = express();
app.use(express.json());

// Serve static landing page
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// CORS headers for MCP endpoint
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version",
};

// OPTIONS preflight
app.options("/mcp", (_req: Request, res: Response) => {
  res.set(CORS_HEADERS).status(204).end();
});

// Store active transports by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();

// MCP endpoint — supports both stateless (no session) and stateful (with session) modes
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  res.set(CORS_HEADERS);

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // If we have a session ID, try to reuse existing transport
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — create server and transport
  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => globalThis.crypto.randomUUID(),
    enableJsonResponse: !req.headers.accept?.includes("text/event-stream"),
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) transports.delete(sid);
  };

  res.on("close", () => {
    // Clean up after 5 minutes of inactivity
    const sid = transport.sessionId;
    if (sid) {
      setTimeout(() => {
        if (transports.has(sid)) {
          transports.get(sid)!.close();
          transports.delete(sid);
        }
      }, 5 * 60 * 1000);
    }
  });

  await server.connect(transport);

  if (transport.sessionId) {
    transports.set(transport.sessionId, transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// SSE endpoint for streaming (GET /mcp with session ID)
app.get("/mcp", (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res
      .set({ ...CORS_HEADERS, Allow: "POST" })
      .status(405)
      .json({
        error:
          "SSE requires an active session. POST to /mcp first to initialize.",
      });
    return;
  }

  const transport = transports.get(sessionId)!;
  res.set(CORS_HEADERS);
  transport.handleRequest(req, res);
});

// Session deletion
app.delete("/mcp", (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    transports.get(sessionId)!.close();
    transports.delete(sessionId);
    res.set(CORS_HEADERS).status(204).end();
    return;
  }

  res
    .set({ ...CORS_HEADERS, Allow: "POST" })
    .status(405)
    .json({ error: "No active session to delete." });
});

// --- Start server ---

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.error(`Loop MCP server listening on port ${PORT}`);
});
