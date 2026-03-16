import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Cached index host so we only resolve once per process
let cachedIndexHost: string | null = null;

interface PineconeIndex {
  name: string;
  host: string;
  metric?: string;
  dimension?: number;
  status?: { ready: boolean; state: string };
}

interface PineconeListIndexesResponse {
  indexes?: PineconeIndex[];
}

/**
 * List all Pinecone indexes using the control plane API.
 */
async function listPineconeIndexes(apiKey: string): Promise<PineconeIndex[]> {
  const response = await fetch("https://api.pinecone.io/indexes", {
    method: "GET",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Pinecone List Indexes API error (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as PineconeListIndexesResponse;
  return data.indexes ?? [];
}

/**
 * Resolve the Pinecone index host, with caching.
 *
 * Priority:
 * 1. PINECONE_INDEX_HOST env var (used directly)
 * 2. PINECONE_INDEX_NAME env var (look up host via List Indexes API)
 * 3. Default names: "impactloop-articles", "impactloop"
 */
async function resolveIndexHost(apiKey: string): Promise<string | null> {
  if (cachedIndexHost) return cachedIndexHost;

  // 1. Explicit host
  const explicitHost = process.env.PINECONE_INDEX_HOST;
  if (explicitHost) {
    cachedIndexHost = explicitHost;
    return cachedIndexHost;
  }

  // 2. Resolve by name
  const indexes = await listPineconeIndexes(apiKey);

  const targetName = process.env.PINECONE_INDEX_NAME;
  const namesToTry = targetName
    ? [targetName]
    : ["impactloop-articles", "impactloop"];

  for (const name of namesToTry) {
    const found = indexes.find(
      (idx) => idx.name.toLowerCase() === name.toLowerCase()
    );
    if (found) {
      cachedIndexHost = found.host;
      return cachedIndexHost;
    }
  }

  return null;
}

export function registerPineconeTools(server: McpServer): void {
  // --- Tool 1: Semantic search ---
  server.registerTool(
    "loop_semantic_search",
    {
      title: "Semantic search articles",
      description:
        "Semantic vector search over impactloop.se articles indexed in Pinecone using vector embeddings. Best for conceptual or topic-based searches where exact keywords may not appear in the text (e.g. 'companies working on carbon capture' or 'AI startups raising funding'). Returns the most relevant article chunks with score, title, and content.\n\nExample: query='greentech investments in Sweden' to find topically related articles.",
      inputSchema: {
        query: z.string().min(2).describe("Search query text"),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Number of results to return (default 10, max 30)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (params) => {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Pinecone is not configured. Set the PINECONE_API_KEY environment variable.",
            },
          ],
        };
      }

      try {
        const indexHost = await resolveIndexHost(apiKey);
        if (!indexHost) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Could not resolve Pinecone index host. Set PINECONE_INDEX_HOST or PINECONE_INDEX_NAME, or ensure an index named 'impactloop-articles' or 'impactloop' exists.",
              },
            ],
          };
        }

        const response = await fetch(
          `https://${indexHost}/records/namespaces/default/search`,
          {
            method: "POST",
            headers: {
              "Api-Key": apiKey,
              "Content-Type": "application/json",
              "X-Pinecone-API-Version": "2025-04",
            },
            body: JSON.stringify({
              query: {
                top_k: params.top_k,
                inputs: { text: params.query },
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Pinecone API error (${response.status}): ${errorText}`,
              },
            ],
            isError: true,
          };
        }

        const data = (await response.json()) as {
          result?: { hits?: Array<Record<string, unknown>> };
        };

        const hits = (data.result?.hits ?? []).map(
          (record: Record<string, unknown>) => {
            const { _id, _score, ...rest } = record;
            return { id: _id, score: _score, ...rest };
          }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(hits, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Pinecone search failed: ${message}`,
            },
          ],
        };
      }
    }
  );

  // --- Tool 2: List Pinecone indexes ---
  server.registerTool(
    "loop_list_pinecone_indexes",
    {
      title: "List Pinecone indexes",
      description:
        "Lists all available Pinecone indexes with their names, hosts, dimensions, and status. Primarily useful for debugging Pinecone configuration and verifying which indexes are available before running loop_semantic_search.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Pinecone is not configured. Set the PINECONE_API_KEY environment variable.",
            },
          ],
        };
      }

      try {
        const indexes = await listPineconeIndexes(apiKey);

        if (indexes.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No Pinecone indexes found for this API key.",
              },
            ],
          };
        }

        const summary = indexes.map((idx) => ({
          name: idx.name,
          host: idx.host,
          metric: idx.metric,
          dimension: idx.dimension,
          status: idx.status,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to list Pinecone indexes: ${message}`,
            },
          ],
        };
      }
    }
  );
}
