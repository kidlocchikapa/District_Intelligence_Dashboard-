import { Bot, X, Send, Loader2, Sparkles, FileText, Lightbulb, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAIPlanner } from "../context/AIPlannerContext";
import api from "../lib/api";

const MODE_CONFIG = {
  query: { icon: Bot, label: "Ask a question" },
  recommendations: { icon: Lightbulb, label: "Recommendations" },
  insights: { icon: Sparkles, label: "Insights" },
};

function AIPlanner() {
  const { plannerState, closeAIPlanner, chatSession, chatHistory, updateChatHistory, startNewConversation } = useAIPlanner();
  const { isOpen, query, title, mode, context } = plannerState;
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const sessionRef = useRef(chatSession);

  const currentMode = MODE_CONFIG[mode] || MODE_CONFIG.query;

  useEffect(() => {
    if (chatSession !== sessionRef.current) {
      setMessages([]);
      setHasInitialized(false);
      sessionRef.current = chatSession;
    }
  }, [chatSession]);

  useEffect(() => {
    if (isOpen && chatHistory.length > 0 && !hasInitialized) {
      setMessages(chatHistory);
      setHasInitialized(true);
    }
  }, [isOpen, chatHistory, hasInitialized]);

  const sendQuery = useCallback(async (q) => {
    if (!q?.trim()) return;
    setIsLoading(true);
    setError(null);
    const userMsg = { role: "user", content: q, id: Date.now() };
    setMessages((prev) => {
      const next = [...prev, userMsg];
      updateChatHistory(next);
      return next;
    });
    try {
      const endpoint = mode === "recommendations" ? "/ai/recommendations" : "/ai/query";
      const payload = { query: q, mode, context };
      const response = await api.post(endpoint, payload);
      const data = response.data?.data || response.data;
      const reply = data?.answer || data?.response || JSON.stringify(data);
      const sources = data?.citations || data?.sources || [];
      const assistantMsg = { role: "assistant", content: reply, sources, id: Date.now() + 1 };
      setMessages((prev) => {
        const next = [...prev, assistantMsg];
        updateChatHistory(next);
        return next;
      });
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to get a response. Please try again.";
      setError(message);
      const errorMsg = { role: "assistant", content: message, isError: true, id: Date.now() + 1 };
      setMessages((prev) => {
        const next = [...prev, errorMsg];
        updateChatHistory(next);
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }, [mode, context, updateChatHistory]);

  useEffect(() => {
    if (query?.trim() && !hasInitialized) {
      setHasInitialized(true);
      setMessages([]);
      sendQuery(query);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendQuery(input.trim());
    setInput("");
  }

  function handleNewConversation() {
    startNewConversation();
    setMessages([]);
    setHasInitialized(false);
    setInput("");
  }

  if (!isOpen) return null;

  const panel = (
    <div className="fixed inset-0 z-[200] flex justify-end">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeAIPlanner} />
      <div className="relative z-10 flex w-full max-w-lg flex-col bg-white shadow-2xl translate-x-0">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900">
              <currentMode.icon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{title || "AI Planning Assistant"}</h2>
              <p className="text-xs font-semibold text-slate-500">{currentMode.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewConversation}
              title="New conversation"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <Plus size={20} />
            </button>
            <button
              onClick={closeAIPlanner}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-sm font-semibold text-slate-500">How can I help with planning?</p>
              <p className="text-xs text-slate-400 mt-1">Ask a question about districts, metrics, or recommendations.</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white"
                    : msg.isError
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-slate-100 text-slate-800"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.sources?.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <FileText size={12} />
                      Sources
                    </p>
                    <ul className="mt-1 space-y-1">
                      {msg.sources.map((src, j) => (
                        <li key={j} className="text-[11px] text-slate-600">
                          {src.title || src.filename || `Source ${j + 1}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? "Waiting for response..." : "Ask a follow-up question..."}
              disabled={isLoading}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}

export default AIPlanner;
