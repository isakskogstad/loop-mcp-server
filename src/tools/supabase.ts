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

/**
 * Normalize and validate Swedish organization numbers.
 * Accepts: "5591234567", "559123-4567", "16559123-4567"
 * Returns: "559123-4567" format or null if invalid.
 */
function normalizeOrgNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // 12 digits: strip leading "16" prefix
  const core = digits.length === 12 && digits.startsWith("16") ? digits.slice(2) : digits;
  if (core.length !== 10) return null;
  return `${core.slice(0, 6)}-${core.slice(6)}`;
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
        "Search the Nyhetskort (news cards) table by keyword, company, date range, category or type. Returns id, headline, org_number, company_name, event_date, event_type, notice_text, and source_url.\n\nExample: query='nyemission', from_date='2024-01-01' to find share issuance events in 2024.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Free-text search on headline"),
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
        const orgNum = params.org_number ? normalizeOrgNumber(params.org_number) : undefined;
        if (params.org_number && !orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select(
            "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
          );

        if (params.query) q = q.ilike("headline", `%${params.query}%`);
        if (orgNum) q = q.eq("org_number", orgNum);
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
      description:
        "Get a single Nyhetskort (news card) by its id. Returns the full record with all fields including headline, notice_text, faktaruta, event_type, source_url, and more. Use this after searching to get complete details for a specific news item.",
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
        "Fetch the latest news cards, optionally filtered by event_type. Common event_type values: protokoll, kungorelse, arsredovisning, gdp_event, aerende. Returns id, headline, org_number, company_name, event_date, event_type, notice_text, source_url.\n\nExample: event_type='protokoll', limit=10 to see the 10 most recent protocol filings.",
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
        "Get company info from CompanyDirectory plus its 10 most recent news events. Returns company details (name, companyForm, municipality, SNI, CEO, chairman, status) and an array of recent_news items. Use org_number format XXXXXX-XXXX.\n\nExample: org_number='559123-4567' to get company profile and latest events.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const orgNum = normalizeOrgNumber(params.org_number);
        if (!orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();

        const [companyRes, newsRes] = await Promise.all([
          sb
            .from("CompanyDirectory")
            .select("*")
            .eq("orgNumber", orgNum)
            .single(),
          sb
            .from("Nyhetskort")
            .select(
              "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
            )
            .eq("org_number", orgNum)
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
        "Search the CompanyDirectory by company name (case-insensitive partial match). Returns orgNumber, name, companyForm, municipality, sniDescription, city, and status for each match.\n\nExample: query='Volvo' to find all companies with Volvo in the name.",
      inputSchema: {
        query: z.string().describe("Company name search query"),
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
        const q = sb
          .from("CompanyDirectory")
          .select(
            "orgNumber, name, companyForm, municipality, sniDescription, city, status"
          )
          .ilike("name", `%${params.query}%`);

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
        "Get the 5 most recent financial records for a company from CompanyFinancials. Returns fiscalYear, nettoomsattning (net revenue), rorelseresultat (operating profit), resultat_efter_finansiella, arets_resultat (net income), summa_tillgangar (total assets), anlaggningstillgangar (fixed assets), and personalkostnader (staff costs).\n\nExample: org_number='556012-3456' to see 5 years of financials.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const orgNum = normalizeOrgNumber(params.org_number);
        if (!orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        const { data, error } = await sb
          .from("CompanyFinancials")
          .select(
            "orgNumber, fiscalYear, nettoomsattning, rorelseresultat, resultat_efter_finansiella, arets_resultat, summa_tillgangar, anlaggningstillgangar, personalkostnader"
          )
          .eq("orgNumber", orgNum)
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
        "Get the CEO (verkstallande direktor) and chairman (styrelseordforande) for a company from CompanyDirectory. Returns orgNumber, company name, ceo, and chairman fields.\n\nExample: org_number='556012-3456' to see who leads the company.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const orgNum = normalizeOrgNumber(params.org_number);
        if (!orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        const { data, error } = await sb
          .from("CompanyDirectory")
          .select("orgNumber, name, ceo, chairman")
          .eq("orgNumber", orgNum)
          .single();

        if (error) return fail(error.message);
        return ok({
          orgNumber: data.orgNumber,
          name: data.name,
          ceo: data.ceo,
          chairman: data.chairman,
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
      description:
        "Get all news events for a company from Nyhetskort. Returns full records including all event types (protokoll, kungorelse, arsredovisning, gdp_event, aerende) sorted by date descending. Supports date filtering with from_date.\n\nExample: org_number='556012-3456', from_date='2024-01-01' to see all events since 2024.",
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
        const orgNum = normalizeOrgNumber(params.org_number);
        if (!orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select("*")
          .eq("org_number", orgNum);

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
        "Search the ProtocolAnalysis table by keyword, company or protocol type. Protocol types include nyemission, fondemission, minskning_aktiekapital, split, utdelning, likvidation, and styrelseforandring. Returns id, org_number, company_name, protocol_type, protocol_date, extracted_data (structured JSON), and news_content.\n\nExample: protocol_type='nyemission' to find all share issuance protocols.",
      inputSchema: {
        query: z.string().max(200).optional().describe("Free-text search on summary"),
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
        const orgNum = params.org_number ? normalizeOrgNumber(params.org_number) : undefined;
        if (params.org_number && !orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        let q = sb
          .from("ProtocolAnalysis")
          .select(
            "id, org_number, company_name, protocol_type, protocol_date, extracted_data, news_content"
          );

        if (params.query) q = q.ilike("news_content", `%${params.query}%`);
        if (orgNum) q = q.eq("org_number", orgNum);
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
        "Search the Kungorelser table (official announcements from Post- och Inrikes Tidningar). Common amnesomrade values: Bolagsverkets registreringar, Konkurser och offentliga ackord, Likvidationer. Common typ values: Aktiebolag, Ekonomisk forening. Returns id, kungorelse_id, org_number, company_name, amnesomrade, typ, underrubrik, publicerad, lan, ort.\n\nExample: type='Konkurser och offentliga ackord', from_date='2024-06-01' to find recent bankruptcies.",
      inputSchema: {
        query: z
          .string()
          .max(200)
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
        const orgNum = params.org_number ? normalizeOrgNumber(params.org_number) : undefined;
        if (params.org_number && !orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();
        let q = sb
          .from("Kungorelser")
          .select(
            "id, kungorelse_id, org_number, company_name, amnesomrade, typ, underrubrik, publicerad, lan, ort"
          );

        if (params.query) q = q.ilike("underrubrik", `%${params.query}%`);
        if (orgNum) q = q.eq("org_number", orgNum);
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
        "Flexible read-only query against any Supabase table. Supports column selection, filtering with various operators, ordering, and pagination. Use loop_list_tables first to discover available tables and their columns. Common tables: Nyhetskort (unified news feed), CompanyDirectory (company profiles), CompanyFinancials (annual financials), ProtocolAnalysis (corporate protocols), Kungorelser (official announcements), Aktiedata (share data), WatchedCompany (monitored companies).\n\nReturns total_count plus the data rows.",
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

  // -----------------------------------------------------------------------
  // 13. loop_get_watchlist_events
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_get_watchlist_events",
    {
      title: "Get watchlist events",
      description:
        "Get recent news events for all companies in a given watchlist. Returns events from the last 7 days by default. Watchlist IDs: '1' (impact companies), '2' (VC portfolio), '3' (family offices).",
      inputSchema: {
        list_id: z.string().describe("Watchlist ID ('1', '2', or '3')"),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(7)
          .describe("Number of days to look back (default 7, max 90)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Max events to return (default 50, max 100)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();

        // Step 1: Get org numbers from the watchlist
        const { data: watchlistData, error: watchlistError } = await sb
          .from("WatchedCompany")
          .select("orgNumber")
          .eq("listId", params.list_id);

        if (watchlistError) return fail(watchlistError.message);
        if (!watchlistData || watchlistData.length === 0) {
          return ok({
            message: "No companies found in this watchlist",
            events: [],
          });
        }

        const orgNumbers = watchlistData.map(
          (w: { orgNumber: string }) => w.orgNumber
        );

        // Step 2: Get recent events for these companies
        const since = new Date();
        since.setDate(since.getDate() - params.days);
        const sinceStr = since.toISOString().split("T")[0];

        const { data: events, error: eventsError } = await sb
          .from("Nyhetskort")
          .select(
            "id, headline, org_number, company_name, event_date, event_type, notice_text, source_url"
          )
          .in("org_number", orgNumbers)
          .gte("event_date", sinceStr)
          .order("event_date", { ascending: false })
          .limit(params.limit);

        if (eventsError) return fail(eventsError.message);

        return ok({
          watchlist_id: params.list_id,
          companies_in_list: orgNumbers.length,
          period: `last ${params.days} days (since ${sinceStr})`,
          events_found: events?.length ?? 0,
          events: events ?? [],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 14. loop_market_stats
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_market_stats",
    {
      title: "Market statistics",
      description:
        "Get aggregated market statistics: count of events by type for a given period. Useful for understanding market activity, trends, and finding spikes in bankruptcies, share issues, etc.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(7)
          .describe("Number of days to look back (default 7, max 365)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();

        const since = new Date();
        since.setDate(since.getDate() - params.days);
        const sinceStr = since.toISOString().split("T")[0];

        // Get all events in the period
        const { data, error } = await sb
          .from("Nyhetskort")
          .select("event_type, event_date, org_number")
          .gte("event_date", sinceStr)
          .order("event_date", { ascending: false });

        if (error) return fail(error.message);

        // Aggregate by event_type
        const byType: Record<string, number> = {};
        const uniqueCompanies = new Set<string>();

        for (const row of data ?? []) {
          const t = row.event_type ?? "unknown";
          byType[t] = (byType[t] ?? 0) + 1;
          if (row.org_number) uniqueCompanies.add(row.org_number);
        }

        // Sort by count descending
        const typeBreakdown = Object.entries(byType)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => ({ type, count }));

        return ok({
          period: `last ${params.days} days (since ${sinceStr})`,
          total_events: data?.length ?? 0,
          unique_companies: uniqueCompanies.size,
          by_event_type: typeBreakdown,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -----------------------------------------------------------------------
  // 15. loop_company_overview
  // -----------------------------------------------------------------------
  server.registerTool(
    "loop_company_overview",
    {
      title: "Company overview",
      description:
        "Get a complete overview of a company in one call: basic info, latest financials, directors, and recent news events. Saves multiple roundtrips.",
      inputSchema: {
        org_number: z.string().describe("Organization number (XXXXXX-XXXX)"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const orgNum = normalizeOrgNumber(params.org_number);
        if (!orgNum) return fail("Invalid organization number format. Expected XXXXXX-XXXX.");

        const sb = getClient();

        const [companyRes, financialsRes, newsRes, protocolsRes] =
          await Promise.all([
            sb
              .from("CompanyDirectory")
              .select(
                "orgNumber, name, companyForm, municipality, sniDescription, city, status, ceo, chairman"
              )
              .eq("orgNumber", orgNum)
              .single(),
            sb
              .from("CompanyFinancials")
              .select(
                "fiscalYear, nettoomsattning, rorelseresultat, resultat_efter_finansiella, arets_resultat, summa_tillgangar, personalkostnader"
              )
              .eq("orgNumber", orgNum)
              .order("fiscalYear", { ascending: false })
              .limit(3),
            sb
              .from("Nyhetskort")
              .select(
                "id, headline, event_date, event_type, notice_text, source_url"
              )
              .eq("org_number", orgNum)
              .order("event_date", { ascending: false })
              .limit(10),
            sb
              .from("ProtocolAnalysis")
              .select("id, protocol_type, protocol_date, news_content")
              .eq("org_number", orgNum)
              .order("protocol_date", { ascending: false })
              .limit(5),
          ]);

        if (companyRes.error) return fail(companyRes.error.message);

        return ok({
          company: companyRes.data,
          financials: financialsRes.data ?? [],
          recent_news: newsRes.data ?? [],
          recent_protocols: protocolsRes.data ?? [],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );
}
