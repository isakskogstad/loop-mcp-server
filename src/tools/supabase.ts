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
            "id, headline, orgNumber, companyName, date, category, type, summary, url"
          );

        if (params.query) q = q.ilike("headline", `%${params.query}%`);
        if (params.org_number) q = q.eq("orgNumber", params.org_number);
        if (params.category) q = q.eq("category", params.category);
        if (params.type) q = q.eq("type", params.type);
        if (params.from_date) q = q.gte("date", params.from_date);
        if (params.to_date) q = q.lte("date", params.to_date);

        const { data, error } = await q
          .order("date", { ascending: false })
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
        "Fetch the latest news cards, optionally filtered by category or type.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results to return (default 20, max 50)"),
        category: z.string().optional().describe("News category to filter by"),
        type: z.string().optional().describe("News type to filter by"),
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async (params) => {
      try {
        const sb = getClient();
        let q = sb
          .from("Nyhetskort")
          .select(
            "id, headline, orgNumber, companyName, date, category, type, summary, url"
          );

        if (params.category) q = q.eq("category", params.category);
        if (params.type) q = q.eq("type", params.type);

        const { data, error } = await q
          .order("date", { ascending: false })
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
              "id, headline, orgNumber, companyName, date, category, type, summary, url"
            )
            .eq("orgNumber", params.org_number)
            .order("date", { ascending: false })
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
            "orgNumber, year, summa_rorelseintakter, resultat_efter_finansiella_poster, summa_eget_kapital, summa_tillgangar, summa_skulder, antal_anstallda, soliditet, kassalikviditet"
          )
          .eq("orgNumber", params.org_number)
          .order("year", { ascending: false })
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
          .eq("orgNumber", params.org_number);

        if (params.from_date) q = q.gte("date", params.from_date);

        const { data, error } = await q
          .order("date", { ascending: false })
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
            "id, orgNumber, companyName, protocolType, summary, date, decisions"
          );

        if (params.query) q = q.ilike("summary", `%${params.query}%`);
        if (params.org_number) q = q.eq("orgNumber", params.org_number);
        if (params.protocol_type)
          q = q.eq("protocolType", params.protocol_type);

        const { data, error } = await q
          .order("date", { ascending: false })
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
            "id, rubrik, org_number, foretagsnamn, typ, datum, lan, amnesomrade"
          );

        if (params.query) q = q.ilike("rubrik", `%${params.query}%`);
        if (params.org_number) q = q.eq("org_number", params.org_number);
        if (params.type) q = q.eq("typ", params.type);
        if (params.from_date) q = q.gte("datum", params.from_date);

        const { data, error } = await q
          .order("datum", { ascending: false })
          .limit(params.limit);

        if (error) return fail(error.message);
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    }
  );
}
