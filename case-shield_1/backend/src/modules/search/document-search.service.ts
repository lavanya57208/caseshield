import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthenticatedUser } from "@/middleware/auth";
import { authorizeDocuments } from "@/lib/authorization";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { AuditService } from "@/modules/audit/audit.service";
import { maskPiiInText } from "@/modules/privacy/pii/deterministic-pii.provider";
import { getAIProvider } from "@/modules/ai/index";
import { SearchQueryInterpretation, StructuredDocumentMetadata } from "@/modules/ai/ai-provider.types";
import { interpretQuery } from "@/modules/ai/heuristics";
import { cosineSimilarity, getEmbeddingProvider } from "@/modules/ai/embeddings";

// Authorization-aware document search — see docs/search-architecture.md.
//
// Order of operations (never reordered):
//   1. Build the candidate set from cases the caller can see (superset).
//   2. Apply the exact document.view decision per document with the batched
//      authorizeDocuments() — the same rule as can().
//   3. Only then rank: full-text (PostgreSQL tsvector over PII-masked text +
//      metadata), title/number matching and, in "intelligent" mode, AI query
//      interpretation and embedding similarity.
// Unauthorized documents are excluded before ranking, so counts, snippets,
// scores and facets can never reveal that they exist. Snippets come only
// from masked text. RESTRICTED documents are keyword-searchable by
// authorized users but never sent to an embedding/AI provider.

// Mirrors OVERSIGHT_ROLES in lib/authorization.ts. The case pre-filter must
// be a SUPERSET of what authorizeDocuments() allows; authorizeDocuments()
// makes the actual decision.
const CASE_WIDE_ROLES = new Set(["ADMIN", "AUDITOR", "JUDGE"]);
const MAX_CANDIDATES = 2000;
const MAX_SEMANTIC_CANDIDATES = 200;
export const SNIPPET_START = "[[";
export const SNIPPET_END = "]]";

export interface DocumentSearchInput {
  q: string;
  mode: "keyword" | "intelligent";
  caseId?: string;
  documentType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
}

export interface DocumentSearchHit {
  documentId: string;
  documentNumber: string;
  title: string;
  caseId: string;
  caseNumber: string;
  type: string;
  suggestedType: string | null;
  confirmedType: string | null;
  confidentiality: string;
  processingStatus: string | null;
  createdAt: Date;
  documentDate: string | null;
  snippet: string | null;
  summary: string | null;
  score: number;
  matchedOn: ("title" | "number" | "tags" | "metadata" | "text" | "semantic")[];
}

function tokens(q: string) {
  return q
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1);
}

function inDateRange(date: string, from?: string, to?: string) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

export const DocumentSearchService = {
  async search(user: AuthenticatedUser, input: DocumentSearchInput, requestId: string) {
    const startedAt = Date.now();
    const q = input.q.trim();

    // --- Intelligent mode: interpret the query (query text only, PII-masked) ---
    let interpretation: SearchQueryInterpretation | null = null;
    let interpretationFallback = false;
    if (input.mode === "intelligent") {
      try {
        interpretation = await getAIProvider().interpretSearchQuery({ query: maskPiiInText(q) });
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "AI query interpretation failed; using heuristic interpretation");
        interpretation = interpretQuery(q);
        interpretationFallback = true;
      }
    }

    const typeFilter = input.documentType ? [input.documentType] : interpretation?.documentTypes.length ? interpretation.documentTypes : [];
    const dateFrom = input.dateFrom ?? interpretation?.dateFrom;
    const dateTo = input.dateTo ?? interpretation?.dateTo;

    // --- 1. Candidate set (superset), scoped to the caller's organization ---
    const now = new Date();
    const caseWide = user.roles.some((r) => CASE_WIDE_ROLES.has(r));
    const caseWhere: Prisma.CaseWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(input.caseId ? { id: input.caseId } : {}),
      ...(interpretation?.caseNumbers.length && !input.caseId ? { caseNumber: { in: interpretation.caseNumbers } } : {}),
      ...(caseWide
        ? {}
        : {
            OR: [
              { investigatingOfficerId: user.id },
              { assignments: { some: { userId: user.id } } },
              {
                permissions: {
                  some: {
                    revokedAt: null,
                    OR: [{ userId: user.id }, { roleId: { in: user.roleIds } }],
                    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
                  },
                },
              },
            ],
          }),
    };

    const docs = await prisma.document.findMany({
      where: {
        deletedAt: null,
        case: caseWhere,
        ...(interpretation?.evidenceNumbers.length ? { evidence: { some: { evidenceNumber: { in: interpretation.evidenceNumbers }, deletedAt: null } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
      include: {
        case: { select: { id: true, caseNumber: true, organizationId: true, investigatingOfficerId: true, confidentiality: true } },
        tags: { select: { tag: true } },
        intelligence: {
          select: {
            versionId: true,
            processingStatus: true,
            suggestedType: true,
            confirmedType: true,
            classificationReview: true,
            extractedMetadata: true,
            confirmedMetadata: true,
            metadataReview: true,
            metadataText: true,
            summary: true,
          },
        },
      },
    });

    // --- 2. Exact per-document authorization (before any ranking) ---
    const decisions = await authorizeDocuments(user, [PERMISSIONS.DOCUMENT_VIEW], docs);
    const authorized = docs
      .filter((d) => decisions.get(d.id)?.has(PERMISSIONS.DOCUMENT_VIEW))
      .map((d) => {
        const intel = d.intelligence.find((i) => i.versionId === d.currentVersionId) ?? null;
        const meta = (intel?.metadataReview === "CONFIRMED" ? intel.confirmedMetadata : intel?.metadataReview === "REJECTED" ? null : intel?.extractedMetadata) as Partial<StructuredDocumentMetadata> | null | undefined;
        const documentDate = typeof meta?.documentDate?.value === "string" ? meta.documentDate.value : null;
        const effectiveType = intel?.classificationReview === "CONFIRMED" ? intel.confirmedType : null;
        return { d, intel, documentDate, effectiveType };
      })
      .filter(({ d, intel, documentDate, effectiveType }) => {
        if (typeFilter.length && ![d.type, effectiveType, intel?.suggestedType].some((t) => t && typeFilter.includes(t))) return false;
        if (dateFrom || dateTo) {
          const date = documentDate ?? d.createdAt.toISOString().slice(0, 10);
          if (!inDateRange(date, dateFrom, dateTo)) return false;
        }
        return true;
      });

    // --- 3. Ranking over the authorized set only ---
    const keywordQuery = interpretation ? (interpretation.keywords.length ? interpretation.keywords.join(" or ") : "") : q;
    const versionIds = authorized.map((a) => a.d.currentVersionId).filter((v): v is string => !!v);
    const textHits = new Map<string, { rank: number; snippet: string | null }>();
    if (keywordQuery && versionIds.length) {
      const rows = await prisma.$queryRaw<{ versionId: string; rank: number; snippet: string | null }[]>`
        SELECT di."versionId",
               ts_rank_cd(di."searchVector", query) AS rank,
               CASE WHEN di."maskedText" IS NULL THEN NULL ELSE
                 ts_headline('english', di."maskedText", query,
                   ${`StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxWords=35, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`})
               END AS snippet
        FROM document_intelligence di, websearch_to_tsquery('english', ${keywordQuery}) query
        WHERE di."versionId" = ANY(${versionIds}::text[]) AND di."searchVector" @@ query`;
      for (const r of rows) textHits.set(r.versionId, { rank: Number(r.rank), snippet: r.snippet });
    }
    const maxRank = Math.max(0, ...[...textHits.values()].map((h) => h.rank)) || 1;

    const qTokens = interpretation ? [...interpretation.keywords, ...interpretation.caseNumbers.map((c) => c.toLowerCase()), ...interpretation.evidenceNumbers.map((e) => e.toLowerCase())] : tokens(q);
    const scored = authorized.map((a) => {
      const matchedOn: DocumentSearchHit["matchedOn"] = [];
      let score = 0;
      const title = a.d.title.toLowerCase();
      if (q && title.includes(q.toLowerCase())) {
        score += 1;
        matchedOn.push("title");
      } else if (qTokens.length) {
        const overlap = qTokens.filter((t) => title.includes(t)).length / qTokens.length;
        if (overlap > 0) {
          score += 0.6 * overlap;
          matchedOn.push("title");
        }
      }
      const numbers = `${a.d.documentNumber} ${a.d.case.caseNumber}`.toLowerCase();
      if (qTokens.some((t) => t.length > 3 && numbers.includes(t)) || (q && numbers.includes(q.toLowerCase()))) {
        score += 1;
        matchedOn.push("number");
      }
      if (a.d.tags.some((t) => qTokens.includes(t.tag.toLowerCase()))) {
        score += 0.3;
        matchedOn.push("tags");
      }
      const text = a.d.currentVersionId ? textHits.get(a.d.currentVersionId) : undefined;
      if (text) {
        score += 0.8 * (text.rank / maxRank) + 0.2;
        const metaText = (a.intel?.metadataText ?? "").toLowerCase();
        matchedOn.push(qTokens.some((t) => metaText.includes(t)) ? "metadata" : "text");
      }
      return { ...a, score, matchedOn, snippet: text?.snippet ?? null };
    });

    // Structured-only intelligent queries ("FIRs in CASE-2024-001") match on filters alone.
    const filterOnly = !!interpretation && !keywordQuery && (typeFilter.length > 0 || !!interpretation.caseNumbers.length || !!interpretation.evidenceNumbers.length || !!dateFrom || !!dateTo);

    // Semantic re-ranking (intelligent mode): embeddings over authorized,
    // non-RESTRICTED candidates' masked title/summary/metadata only.
    let semanticProvider: string | null = null;
    let semanticError: string | null = null;
    if (input.mode === "intelligent" && q) {
      const pool = scored
        .filter((s) => s.d.confidentiality !== "RESTRICTED")
        .sort((x, y) => y.score - x.score || y.d.createdAt.getTime() - x.d.createdAt.getTime())
        .slice(0, MAX_SEMANTIC_CANDIDATES);
      if (pool.length) {
        try {
          const provider = getEmbeddingProvider();
          const texts = pool.map((s) => maskPiiInText([s.d.title, s.intel?.summary ?? "", s.intel?.metadataText ?? ""].join(". ")));
          const [queryVector, ...docVectors] = await provider.embed([maskPiiInText(q), ...texts]);
          pool.forEach((s, i) => {
            const similarity = cosineSimilarity(queryVector, docVectors[i]);
            if (similarity > 0.15) {
              s.score += 0.7 * similarity;
              s.matchedOn.push("semantic");
            }
          });
          semanticProvider = provider.name;
        } catch (err) {
          semanticError = "Semantic ranking was unavailable; results use keyword ranking only.";
          logger.warn({ err: (err as Error).message }, "embedding provider failed during search");
        }
      }
    }

    const matches = scored
      .filter((s) => s.score > 0 || filterOnly)
      .sort((x, y) => y.score - x.score || y.d.createdAt.getTime() - x.d.createdAt.getTime());
    const results: DocumentSearchHit[] = matches.slice(0, input.limit).map((s) => ({
      documentId: s.d.id,
      documentNumber: s.d.documentNumber,
      title: s.d.title,
      caseId: s.d.caseId,
      caseNumber: s.d.case.caseNumber,
      type: s.d.type,
      suggestedType: s.intel?.suggestedType ?? null,
      confirmedType: s.effectiveType,
      confidentiality: s.d.confidentiality,
      processingStatus: s.intel?.processingStatus ?? null,
      createdAt: s.d.createdAt,
      documentDate: s.documentDate,
      snippet: s.snippet,
      summary: s.intel?.summary ? s.intel.summary.slice(0, 280) : null,
      score: Math.round(s.score * 1000) / 1000,
      matchedOn: [...new Set(s.matchedOn)],
    }));

    // The query itself is not audited (it may contain personal data) — only its shape.
    await AuditService.record({
      actorId: user.id,
      actorRole: user.roles[0],
      action: "DOCUMENT_SEARCH_PERFORMED",
      resource: "search:documents",
      caseId: input.caseId ?? null,
      result: "SUCCESS",
      requestId,
      metadata: {
        mode: input.mode,
        queryLength: q.length,
        resultCount: matches.length,
        filters: { caseId: input.caseId ?? null, documentType: input.documentType ?? null, dateFrom: dateFrom ?? null, dateTo: dateTo ?? null },
        semantic: !!semanticProvider,
      },
    });

    return {
      mode: input.mode,
      total: matches.length,
      results,
      interpretation: interpretation ? { ...interpretation, fallback: interpretationFallback } : null,
      ranking: {
        keyword: "PostgreSQL full-text (ts_rank_cd) over PII-masked text and metadata, plus title/number matching",
        semanticProvider,
        semanticError,
      },
      tookMs: Date.now() - startedAt,
    };
  },
};
