import {
  BadgeInfo,
  Bot,
  ChevronRight,
  FileText,
  History,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  X,
  ExternalLink,
  MapPin,
  Tags,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { fetchJson, hasAuthToken, postJson } from "../lib/api";
import { useAIPlanner } from "../context/AIPlannerContext";

const MODE_CONFIG = {
  query: {
    label: "Ask",
    title: "Ask the planning assistant",
    description: "Ask a natural-language question and ground it in retrieved planning documents.",
  },
  recommendations: {
    label: "Recommend",
    title: "Generate recommendations",
    description: "Turn the retrieved evidence into practical district planning actions.",
  },
  insights: {
    label: "Insight",
    title: "Metric insight",
    description: "Explain what the selected metric means and what planners should do next.",
  },
  report: {
    label: "Report",
    title: "Draft report section",
    description: "Create a report-ready analysis block for PDF or export workflows.",
  },
};

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function defaultQuestion(mode, scopeLabel, metricLabel) {
  if (mode === "recommendations") {
    return `What interventions work best for ${scopeLabel || "this area"}?`;
  }

  if (mode === "insights") {
    return metricLabel
      ? `What does the ${metricLabel} metric imply for planning in ${scopeLabel || "this area"}?`
      : `What does this metric imply for planning in ${scopeLabel || "this area"}?`;
  }

  if (mode === "report") {
    return `Draft a concise report section for ${scopeLabel || "this area"} using the retrieved planning evidence.`;
  }

  return `What interventions work best for ${scopeLabel || "this area"}?`;
}

function getHistoryKey(scopeLabel) {
  return `district-ai-history:${normalizeText(scopeLabel || "global").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function loadHistory(scopeLabel) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(getHistoryKey(scopeLabel));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveHistory(scopeLabel, history) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(getHistoryKey(scopeLabel), JSON.stringify(history.slice(0, 8)));
  } catch {
    void 0;
  }
}

function getModeConfig(mode) {
  return MODE_CONFIG[mode] || MODE_CONFIG.query;
}

function Chip({ children, icon: Icon, tone = "default" }) {
  const toneClasses = {
    default: "border-white/15 bg-white/10 text-white/90",
    muted: "border-slate-200 bg-slate-50 text-slate-600",
    warm: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClasses[tone] || toneClasses.default}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

function SourceCard({ source, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${active ? "text-white/55" : "text-slate-400"}`}>
            {source.citation_label || "Planning source"}
          </p>
          <h4 className="mt-1 truncate text-[14px] font-extrabold">
            {source.title}
          </h4>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            active ? "bg-white/15 text-white" : "bg-amber-50 text-amber-800"
          }`}
        >
          {Math.round((Number(source.score || 0) * 100))}
        </span>
      </div>
      <p className={`mt-3 text-[12px] leading-5 ${active ? "text-white/80" : "text-slate-600"}`}>
        {source.excerpt || source.summary || "No excerpt available."}
      </p>
    </button>
  );
}

export default function AIPlanner() {
  const { plannerState, closeAIPlanner, openAIPlanner } = useAIPlanner();
  const navigate = useNavigate();
  const [mode, setMode] = useState(plannerState.mode || "query");
  const [draftQuery, setDraftQuery] = useState(
    plannerState.query || defaultQuestion(plannerState.mode, plannerState.context?.scopeLabel, plannerState.metricLabel),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");
  const [selectedSource, setSelectedSource] = useState(null);
  const [sourceDetail, setSourceDetail] = useState(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [history, setHistory] = useState(() => loadHistory(plannerState.context?.scopeLabel));

  const context = plannerState.context || {};
  const scopeLabel = normalizeText(context.scopeLabel || context.ta || context.district || "this area");
  const modeConfig = getModeConfig(mode);
  const authRequired = Boolean(plannerState.authRequired && !hasAuthToken());

  useEffect(() => {
    if (!plannerState.isOpen) {
      return;
    }

    const nextMode = plannerState.mode || "query";
    setMode(nextMode);
    setDraftQuery(
      plannerState.query ||
        defaultQuestion(nextMode, plannerState.context?.scopeLabel, plannerState.metricLabel),
    );
    setError("");
    setResponse(null);
    setSelectedSource(null);
    setSourceDetail(null);
    setHistory(loadHistory(plannerState.context?.scopeLabel));
  }, [
    plannerState.context?.scopeLabel,
    plannerState.isOpen,
    plannerState.metricLabel,
    plannerState.mode,
    plannerState.query,
  ]);

  useEffect(() => {
    if (!plannerState.isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeAIPlanner();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeAIPlanner, plannerState.isOpen]);

  async function loadSourceDetail(source) {
    if (!source?.document_id) {
      return;
    }

    setSelectedSource(source);
    setSourceLoading(true);
    setSourceDetail(null);

    try {
      const payload = await fetchJson(`/ai/documents/${source.document_id}`);
      const documentRecord = payload?.document || payload || null;
      setSourceDetail(
        documentRecord
          ? {
              ...documentRecord,
              chunks: payload?.chunks || documentRecord?.chunks || [],
              document: documentRecord,
            }
          : null,
      );
    } catch (fetchError) {
      setError(fetchError.response?.data?.message || fetchError.message || "Unable to load source details.");
    } finally {
      setSourceLoading(false);
    }
  }

  function rememberQuery(nextResponse, nextQuery, nextMode) {
    const nextHistory = [
      {
        query: normalizeText(nextQuery),
        mode: nextMode,
        scopeLabel,
        timestamp: new Date().toISOString(),
        answer: normalizeText(nextResponse?.answer || "").slice(0, 180),
      },
      ...history.filter((item) => normalizeText(item.query) !== normalizeText(nextQuery)),
    ].slice(0, 8);

    setHistory(nextHistory);
    saveHistory(scopeLabel, nextHistory);
  }

  async function submitPlanner(event) {
    event?.preventDefault?.();
    if (!hasAuthToken()) {
      setError("Please sign in to use the AI planner.");
      return;
    }

    const payloadContext = {
      district: context.district,
      ta: context.ta,
      metricId: plannerState.metricId || context.metricId,
      metricLabel: plannerState.metricLabel || context.metricLabel,
      department: context.department,
      scopeLabel,
      sourceHint: context.sourceHint,
    };
    const requestQuery = normalizeText(draftQuery) || defaultQuestion(mode, scopeLabel, plannerState.metricLabel);

    setIsSubmitting(true);
    setError("");

    try {
      let payload;

      if (mode === "recommendations") {
        payload = await postJson("/ai/recommendations", {
          query: requestQuery,
          context: payloadContext,
          topK: 5,
        });
      } else if (mode === "insights") {
        const metricId = normalizeText(plannerState.metricId || context.metricId);
        if (!metricId) {
          throw new Error("Select a metric before generating insights.");
        }

        payload = await postJson(`/ai/insights/${encodeURIComponent(metricId)}`, {
          query: requestQuery,
          context: payloadContext,
          topK: 5,
        });
      } else if (mode === "report") {
        payload = await postJson("/ai/report", {
          query: requestQuery,
          sectionTitle: plannerState.title || context.metricLabel || `Planning note for ${scopeLabel}`,
          outline: [
            "Executive summary",
            "Evidence used",
            "Recommended actions",
            "Implementation caveats",
          ],
          context: payloadContext,
          topK: 5,
        });
      } else {
        payload = await postJson("/ai/query", {
          query: requestQuery,
          mode: "query",
          context: payloadContext,
          topK: 5,
        });
      }

      const nextResponse = payload?.data || payload;
      setResponse(nextResponse);
      rememberQuery(nextResponse, requestQuery, mode);
      if (Array.isArray(nextResponse?.citations) && nextResponse.citations.length) {
        setSelectedSource(nextResponse.citations[0]);
      }
    } catch (submitError) {
      setError(submitError.response?.data?.message || submitError.message || "Unable to generate an AI response.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function loadHistoryItem(item) {
    setMode(item.mode || "query");
    setDraftQuery(item.query || "");
  }

  function applyQuickPrompt(prompt) {
    setDraftQuery(prompt);
  }

  const quickPrompts = useMemo(
    () => [
      defaultQuestion(mode, scopeLabel, plannerState.metricLabel),
      `What should we do first in ${scopeLabel}?`,
      "Which interventions have the strongest evidence in the retrieved documents?",
      "What should be included in a report section for this area?",
    ],
    [mode, plannerState.metricLabel, scopeLabel],
  );

  if (!plannerState.isOpen) {
    return null;
  }

  if (authRequired) {
    const panel = (
      <div className="fixed inset-0 z-[240]">
        <button
          type="button"
          aria-label="Close AI planner"
          onClick={closeAIPlanner}
          className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
        />

        <aside className="absolute right-0 top-0 flex h-full w-full max-w-[760px] flex-col overflow-hidden border-l border-slate-200 bg-[#f7f5ef] shadow-2xl">
          <header className="border-b border-white/10 bg-[#10231b] text-white">
            <div className="flex items-start justify-between gap-4 px-5 py-5">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/75">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Planner
                </div>
                <h2 className="mt-3 text-2xl font-black tracking-tight">
                  Sign in required
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">
                  The planning assistant uses authenticated routes so queries, recommendations, and audit logs can be tracked securely.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAIPlanner}
                className="rounded-full border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/15"
                aria-label="Close planner"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8">
            <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Protected feature
              </div>
              <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                Please sign in to ask the AI planner
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Once you are signed in, the assistant can retrieve planning documents, generate cited recommendations, and log the query for audit purposes.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    closeAIPlanner();
                    navigate("/login");
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Go to sign in
                </button>
                <button
                  type="button"
                  onClick={closeAIPlanner}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    );

    if (typeof document === "undefined") {
      return null;
    }

    return createPortal(panel, document.body);
  }

  const panel = (
    <div className="fixed inset-0 z-[240]">
      <button
        type="button"
        aria-label="Close AI planner"
        onClick={closeAIPlanner}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[1040px] flex-col overflow-hidden border-l border-slate-200 bg-[#f7f5ef] shadow-2xl">
        <header className="border-b border-white/10 bg-[#10231b] text-white">
          <div className="flex items-start justify-between gap-4 px-5 py-5">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/75">
                <Sparkles className="h-3.5 w-3.5" />
                AI Planner
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-tight">
                {modeConfig.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">
                {modeConfig.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Chip icon={MapPin}>{context.district || "All districts"}</Chip>
                {context.ta ? <Chip icon={Target}>{context.ta}</Chip> : null}
                {plannerState.metricLabel ? <Chip icon={BadgeInfo}>{plannerState.metricLabel}</Chip> : null}
                {plannerState.sourceTitle ? <Chip icon={FileText}>{plannerState.sourceTitle}</Chip> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={closeAIPlanner}
              className="rounded-full border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/15"
              aria-label="Close planner"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/10 px-5 py-4">
            {Object.entries(MODE_CONFIG).map(([key, item]) => {
              const active = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                    active
                      ? "border-white bg-white text-[#10231b]"
                      : "border-white/15 bg-white/10 text-white/80 hover:bg-white/15"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="flex min-h-0 flex-col border-r border-slate-200 bg-[#f7f5ef]">
            <form onSubmit={submitPlanner} className="border-b border-slate-200 bg-white/80 px-5 py-5 backdrop-blur">
              <label className="block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Planning question
              </label>
              <textarea
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Ask about interventions, policy trade-offs, service gaps, or report drafting..."
                className="mt-2 min-h-[124px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/5"
              />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() => setDraftQuery(defaultQuestion(mode, scopeLabel, plannerState.metricLabel))}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Reset prompt
                </button>
              </div>
            </form>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Quick prompts
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => applyQuickPrompt(prompt)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {error}
                </div>
              ) : null}

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      Response
                    </div>
                    <h3 className="mt-1 text-[18px] font-extrabold text-slate-900">
                      {response?.answer ? "AI planning response" : "Awaiting response"}
                    </h3>
                  </div>
                  {response?.metadata ? (
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500">
                      {response.metadata.sources_count || 0} sources
                    </div>
                  ) : null}
                </div>

                {response?.report_sections?.length ? (
                  <div className="mt-4 space-y-4">
                    {response.report_sections.map((section) => (
                      <article key={section.heading} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <h4 className="text-[14px] font-extrabold text-slate-900">
                          {section.heading}
                        </h4>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                          {section.body}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                      {response?.answer || "Your answer will appear here once you generate a response."}
                    </p>
                  </div>
                )}

                {Array.isArray(response?.bullets) && response.bullets.length ? (
                  <div className="mt-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      Extracted actions
                    </div>
                    <div className="mt-2 space-y-2">
                      {response.bullets.map((bullet, index) => (
                        <div key={`${bullet}-${index}`} className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] leading-6 text-slate-700">
                          <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                          <span>{bullet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <History className="h-4 w-4" />
                  Recent prompts
                </div>
                <div className="mt-3 space-y-2">
                  {history.length ? (
                    history.map((item) => (
                      <button
                        key={`${item.timestamp}-${item.query}`}
                        type="button"
                        onClick={() => loadHistoryItem(item)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
                      >
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                          {item.mode}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {item.query}
                        </div>
                        {item.answer ? (
                          <div className="mt-1 text-[12px] leading-5 text-slate-500">
                            {item.answer}
                          </div>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                      No saved prompts yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto bg-[#faf8f2] px-5 py-5">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <MapPin className="h-4 w-4" />
                  Planning context
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="font-semibold text-slate-500">District</span>
                    <span className="font-bold text-slate-900">{context.district || "All districts"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="font-semibold text-slate-500">TA</span>
                    <span className="font-bold text-slate-900">{context.ta || "All TAs"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="font-semibold text-slate-500">Metric</span>
                    <span className="font-bold text-slate-900">{plannerState.metricLabel || plannerState.metricId || "None selected"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-500">Scope</span>
                    <span className="font-bold text-slate-900">{scopeLabel}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <FileText className="h-4 w-4" />
                  Retrieved sources
                </div>
                <div className="mt-3 space-y-2">
                  {Array.isArray(response?.citations) && response.citations.length ? (
                    response.citations.map((source) => (
                      <SourceCard
                        key={`${source.document_id}-${source.chunk_id}`}
                        source={source}
                        active={selectedSource?.document_id === source.document_id}
                        onClick={() => loadSourceDetail(source)}
                      />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                      Retrieved sources will appear here after you ask a question.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <ExternalLink className="h-4 w-4" />
                  Source detail
                </div>
                {sourceLoading ? (
                  <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading source detail...
                  </div>
                ) : sourceDetail ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <h4 className="text-[15px] font-extrabold text-slate-900">
                        {sourceDetail.title}
                      </h4>
                      <p className="mt-1 text-[12px] font-semibold text-slate-500">
                        {sourceDetail.summary || sourceDetail.document?.summary || "No summary provided."}
                      </p>
                      {selectedSource?.link ? (
                        <div className="mt-2 space-y-2">
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-mono break-all text-slate-500">
                            {selectedSource.link}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                                navigator.clipboard.writeText(selectedSource.link).catch(() => void 0);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Copy citation link
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                        Content preview
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">
                        {normalizeText(sourceDetail.content || sourceDetail.document?.content || "No content available.")}
                      </p>
                    </div>
                    {Array.isArray(sourceDetail.chunks) && sourceDetail.chunks.length ? (
                      <div className="space-y-2">
                        {sourceDetail.chunks.slice(0, 3).map((chunk) => (
                          <div key={chunk.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                              Chunk {chunk.chunk_index + 1}
                            </div>
                            <p className="mt-1 text-[13px] leading-6 text-slate-700">
                              {chunk.chunk_summary || chunk.chunk_text}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500">
                    Click a retrieved source to inspect the underlying document.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  <Tags className="h-4 w-4" />
                  Response metadata
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="font-semibold text-slate-500">Mode</span>
                    <span className="font-bold text-slate-900">{mode}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                    <span className="font-semibold text-slate-500">Sources</span>
                    <span className="font-bold text-slate-900">{response?.metadata?.sources_count || response?.citations?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-500">Fallback</span>
                    <span className="font-bold text-slate-900">{response?.metadata?.fallback_used ? "Yes" : "No"}</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </aside>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(panel, document.body);
}
