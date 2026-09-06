import express from "express";
import dotenv from "dotenv";
import { uidFromAuthHeader, checkRateLimit, AuthError, RateLimitError } from "./auth";
import { TOOLS, TOOLS_BY_NAME } from "./tools";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const PROTOCOL_VERSION = "2024-11-05";

// JSON-RPC error codes. -32001 is an application error, used here for auth and rate limits.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
const APPLICATION_ERROR = -32001;

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * Logging policy: the tool name and the uid, and nothing else.
 *
 * Never log arguments and never log results. Both contain what somebody wrote in their
 * private journal.
 */
function log(uid: string, tool: string, outcome: "ok" | "error") {
  console.log(`[mcp] uid=${uid} tool=${tool} outcome=${outcome}`);
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

// Unauthenticated. Reports nothing about any user.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", tools: TOOLS.length, protocolVersion: PROTOCOL_VERSION });
});

app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body || {};

  if (!method || typeof method !== "string") {
    return res.status(400).json(rpcError(id, INVALID_REQUEST, "Missing method."));
  }

  // Every request is authenticated, including initialize and tools/list. An
  // unauthenticated caller does not get to learn the tool surface either.
  let uid: string;
  try {
    uid = await uidFromAuthHeader(req.headers.authorization);
    checkRateLimit(uid);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).json(rpcError(id, APPLICATION_ERROR, err.message));
    }
    if (err instanceof AuthError) {
      // An MCP error, never data.
      return res.status(401).json(rpcError(id, APPLICATION_ERROR, err.message));
    }
    return res.status(401).json(rpcError(id, APPLICATION_ERROR, "Unauthorized."));
  }

  try {
    if (method === "initialize") {
      return res.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "compass-journal", version: "1.0.0" },
        })
      );
    }

    if (method === "notifications/initialized") {
      return res.status(204).end();
    }

    if (method === "tools/list") {
      return res.json(
        rpcResult(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        })
      );
    }

    if (method === "tools/call") {
      const name = params?.name;
      const tool = typeof name === "string" ? TOOLS_BY_NAME.get(name) : undefined;
      if (!tool) {
        return res.json(rpcError(id, METHOD_NOT_FOUND, `No tool named ${String(name)}.`));
      }

      try {
        // The uid is passed as a separate argument. Nothing in `params.arguments` can
        // reach the query root.
        const result = await tool.handler(uid, params?.arguments || {});
        log(uid, tool.name, "ok");
        return res.json(
          rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          })
        );
      } catch (toolErr: any) {
        log(uid, tool.name, "error");
        return res.json(
          rpcResult(id, {
            content: [{ type: "text", text: String(toolErr?.message || "The tool failed.") }],
            isError: true,
          })
        );
      }
    }

    return res.json(rpcError(id, METHOD_NOT_FOUND, `Unsupported method ${method}.`));
  } catch (err: any) {
    console.error("[mcp] server error:", err?.message || err);
    return res.status(500).json(rpcError(id, INTERNAL_ERROR, "Internal error."));
  }
});

app.use((req, res) => {
  if (req.method === "POST") {
    return res.status(404).json(rpcError(null, PARSE_ERROR, "Not found. The MCP endpoint is POST /mcp."));
  }
  return res.status(404).end();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Compass MCP server listening on 0.0.0.0:${PORT}, ${TOOLS.length} tools`);
});
