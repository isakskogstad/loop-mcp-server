import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";

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

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// MCP endpoint — stateless, one transport per request
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => transport.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE not supported
app.get("/mcp", (_req: Request, res: Response) => {
  res
    .status(405)
    .json({ error: "SSE transport is not supported. Use POST /mcp." });
});

// Sessions not supported
app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({ error: "Session deletion is not supported." });
});

// --- Start server ---

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.error(`Loop MCP server listening on port ${PORT}`);
});
