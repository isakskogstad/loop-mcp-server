import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Lazy-initialized Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: "Error: " + message }],
    isError: true,
  };
}

const READONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

// ---------------------------------------------------------------------------
// Register all Supabase-backed tools
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // 1. loop_search_news
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_search_news",
    {
      title: "Search news",
      description:
        "Search the Nyhetskort (news cards) table by keyword, company, date range, category or type.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search on headline"),
        org_number: z
          .string()
          .optional()
          .describe("Organization number (XXXXXX-XXXX) to filter by"),
        from_date: z
          .string()
          .optional()
          .describe("Start date (YYYY-MM-DD) inclusive"),
        to_date: z
          .string()
          .optional()
          .describe("End date (YYYY-MM-DD) inclusive"),
        category: z.string().optional().describe("News category to filter by"),
        type: z.string().optional().describe("News type to filter by"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select(
            "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
          );

        if (params.query) q = q.ilike("headline", `%${params.query}%`);
        if (params.org_number) q = q.eq("org_number", params.org_number);
        if (params.category) q = q.eq("event_type", params.category);
        if (params.type) q = q.eq("event_type", params.type);
        if (params.from_date) q = q.gte("event_date", params.from_date);
        if (params.to_date) q = q.lte("event_date", params.to_date);

        const { data, error } = await q
          .order("event_date", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 2. loop_get_news_item
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_news_item",
    {
      title: "Get news item",
      description: "Get a single Nyhetskort (news card) by its id.",
      inputSchema: {
        id: z.string().describe("The news item id"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        const { data, error } = await sb
          .from("Nyhetskort")
          .select("*")
          .eq("id", params.id)
          .single();

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 3. loop_list_recent_news
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_list_recent_news",
    {
      title: "List recent news",
      description:
        "Fetch the latest news cards, optionally filtered by event_type.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
        event_type: z
          .string()
          .optional()
          .describe(
            "Event type to filter by (e.g. protokoll, kungorelse, arsredovisning)"
          ),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select(
            "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
          );

        if (params.event_type) q = q.eq("event_type", params.event_type);

        const { data, error } = await q
          .order("event_date", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 4. loop_get_company
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_company",
    {
      title: "Get company",
      description:
        "Get company info from CompanyDirectory plus its 10 most recent news events.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();

        const [companyRes, newsRes] = await Promise.all([
          sb
            .from("CompanyDirectory")
            .select("*")
            .eq("orgNumber", params.org_number)
            .single(),
          sb
            .from("Nyhetskort")
            .select(
              "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
            )
            .eq("org_number", params.org_number)
            .order("event_date", { ascending: false })
            .limit(10),
        ]);

        if (companyRes.error) return fail(companyRes.error.message);

        return ok({
          company: companyRes.data,
          recent_news: newsRes.data ?? [],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 5. loop_search_companies
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_search_companies",
    {
      title: "Search companies",
      description:
        "Search the CompanyDirectory by name, optionally filtered by impact niche.",
      inputSchema: {
        query: z.string().describe("Company name search query"),
        impact_niche: z
          .string()
          .optional()
          .describe("Impact niche tag to filter by"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("CompanyDirectory")
          .select("orgNumber, name, impactNiches, bolesformDesc, kommun")
          .ilike("name", `%${params.query}%`);

        if (params.impact_niche) {
          q = q.contains("impactNiches", [params.impact_niche]);
        }

        const { data, error } = await q.limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 6. loop_get_company_financials
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_company_financials",
    {
      title: "Get company financials",
      description:
        "Get the 5 most recent financial records for a company from CompanyFinancials.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        const { data, error } = await sb
          .from("CompanyFinancials")
          .select(
            "orgNumber, fiscalYear, nettoomsattning, rorelseresultat, resultat_efter_finansiella, arets_resultat, summa_tillgangar, anlaggningstillgangar, personalkostnader"
          )
          .eq("orgNumber", params.org_number)
          .order("fiscalYear", { ascending: false })
          .limit(5);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 7. loop_get_company_directors
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_company_directors",
    {
      title: "Get company directors",
      description:
        "Get the board of directors for a company (from the directors JSONB field on CompanyDirectory).",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        const { data, error } = await sb
          .from("CompanyDirectory")
          .select("orgNumber, name, directors")
          .eq("orgNumber", params.org_number)
          .single();

        if (error) return fail(error.message);
        return ok({
          orgNumber: data.orgNumber,
          name: data.name,
          directors: data.directors ?? [],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 8. loop_get_company_events
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_company_events",
    {
      title: "Get company events",
      description: "Get all news events for a company from Nyhetskort.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe("Max results to return (default 30, max 100)"),
        from_date: z
          .string()
          .optional()
          .describe("Start date (YYYY-MM-DD) inclusive"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select("*")
          .eq("org_number", params.org_number);

        if (params.from_date) q = q.gte("event_date", params.from_date);

        const { data, error } = await q
          .order("event_date", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 9. loop_search_protocols
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_search_protocols",
    {
      title: "Search protocols",
      description:
        "Search the ProtocolAnalysis table by keyword, company or protocol type.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search on summary"),
        org_number: z
          .string()
          .optional()
          .describe("Organization number (XXXXXX-XXXX) to filter by"),
        protocol_type: z
          .string()
          .optional()
          .describe("Protocol type to filter by"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("ProtocolAnalysis")
          .select(
            "id, org_number, company_name, protocol_type, protocol_date, extracted_data, news_content"
          );

        if (params.query) q = q.ilike("news_content", `%${params.query}%`);
        if (params.org_number) q = q.eq("org_number", params.org_number);
        if (params.protocol_type)
          q = q.eq("protocol_type", params.protocol_type);

        const { data, error } = await q
          .order("protocol_date", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 10. loop_search_kungorelser
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_search_kungorelser",
    {
      title: "Search kungörelser",
      description:
        "Search the Kungorelser table (official announcements from Post- och Inrikes Tidningar).",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Free-text search on rubrik (headline)"),
        org_number: z
          .string()
          .optional()
          .describe("Organization number to filter by"),
        type: z.string().optional().describe("Kungörelse typ to filter by"),
        from_date: z
          .string()
          .optional()
          .describe("Start date (YYYY-MM-DD) inclusive"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("Kungorelser")
          .select(
            "id, kungorelse_id, org_number, company_name, amnesomrade, typ, underrubrik, publicerad, lan, ort"
          );

        if (params.query) q = q.ilike("underrubrik", `%${params.query}%`);
        if (params.org_number) q = q.eq("org_number", params.org_number);
        if (params.type) q = q.eq("typ", params.type);
        if (params.from_date) q = q.gte("publicerad", params.from_date);

        const { data, error } = await q
          .order("publicerad", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 11. loop_query_table
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_query_table",
    {
      title: "Query any table",
      description:
        "Flexible read-only query against any Supabase table. Supports column selection, filtering with various operators, ordering, and pagination. Use loop_list_tables first to discover available tables and their columns.",
      inputSchema: {
        table: z.string().describe("Table name to query"),
        select: z
          .string()
          .default("*")
          .describe("Columns to select (PostgREST syntax, default '*')"),
        filters: z
          .array(
            z.object({
              column: z.string().describe("Column name"),
              operator: z
                .enum([
                  "eq",
                  "neq",
                  "gt",
                  "gte",
                  "lt",
                  "lte",
                  "like",
                  "ilike",
                  "is",
                  "in",
                  "contains",
                  "containedBy",
                  "overlaps",
                ])
                .describe("Filter operator"),
              value: z
                .union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.null(),
                  z.array(z.unknown()),
                ])
                .describe(
                  "Value to compare against. Use array for 'in', 'contains', 'containedBy', 'overlaps'. Use null with 'is'."
                ),
            })
          )
          .optional()
          .describe("Array of filter conditions"),
        order_by: z.string().optional().describe("Column to order by"),
        ascending: z
          .boolean()
          .default(false)
          .describe("Sort ascending (default false = descending)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("Max rows to return (default 20, max 200)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of rows to skip (for pagination, default 0)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = sb
          .from(params.table)
          .select(params.select, { count: "exact" });

        // Apply filters
        if (params.filters) {
          for (const f of params.filters) {
            switch (f.operator) {
              case "eq":
                q = q.eq(f.column, f.value);
                break;
              case "neq":
                q = q.neq(f.column, f.value);
                break;
              case "gt":
                q = q.gt(f.column, f.value);
                break;
              case "gte":
                q = q.gte(f.column, f.value);
                break;
              case "lt":
                q = q.lt(f.column, f.value);
                break;
              case "lte":
                q = q.lte(f.column, f.value);
                break;
              case "like":
                q = q.like(f.column, f.value as string);
                break;
              case "ilike":
                q = q.ilike(f.column, f.value as string);
                break;
              case "is":
                q = q.is(f.column, f.value);
                break;
              case "in":
                q = q.in(f.column, f.value as unknown[]);
                break;
              case "contains":
                q = q.contains(f.column, f.value);
                break;
              case "containedBy":
                q = q.containedBy(f.column, f.value);
                break;
              case "overlaps":
                q = q.overlaps(f.column, f.value);
                break;
            }
          }
        }

        // Ordering
        if (params.order_by) {
          q = q.order(params.order_by, { ascending: params.ascending });
        }

        // Pagination
        q = q.range(params.offset, params.offset + params.limit - 1);

        const { data, error, count } = await q;

        if (error) return fail(error.message);
        return ok({
          total_count: count,
          rows_returned: data?.length ?? 0,
          data,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 12. loop_list_tables
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_list_tables",
    {
      title: "List database tables",
      description:
        "List all available tables in the Supabase database with their column names. Useful for discovering what data is available before using loop_query_table.",
      inputSchema: {},
      annotations: READONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const supabaseUrl = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

        const res = await fetch(`${supabaseUrl}/rest/v1/`, {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        });

        if (!res.ok) {
          return fail(`PostgREST returned ${res.status}: ${await res.text()}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openapi = (await res.json()) as any;
        const paths = openapi.paths ?? {};
        const definitions = openapi.definitions ?? {};

        const tables: Array<{
          name: string;
          description: string | null;
          columns: string[];
        }> = [];

        for (const [path, methods] of Object.entries(paths)) {
          const tableName = path.replace(/^\//, "");
          if (!tableName || tableName.startsWith("rpc/")) continue;

          const desc =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (methods as any)?.get?.description ??
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (methods as any)?.post?.description ??
            null;

          // Extract columns from definitions
          const def = definitions[tableName];
          const columns = def?.properties ? Object.keys(def.properties) : [];

          tables.push({ name: tableName, description: desc, columns });
        }

        // Sort alphabetically
        tables.sort((a, b) => a.name.localeCompare(b.name));

        return ok({ total_tables: tables.length, tables });
      } catch (e) {
        return fail(e);
      }
    }
  );
}
