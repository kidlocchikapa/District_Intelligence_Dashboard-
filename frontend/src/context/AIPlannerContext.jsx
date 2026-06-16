import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useDistrict } from "./DistrictContext";

const AIPlannerContext = createContext(null);
const CHAT_STORAGE_KEY = "ai_planner_chat_history";

function loadChatHistory() {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveChatHistory(messages) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-100)));
  } catch {
  }
}

function buildDefaultContext(selectedDistrict, selectedTa) {
  const district = selectedDistrict || "Zomba";
  const ta = selectedTa || "";
  return {
    district,
    ta,
    scopeLabel: ta || district,
  };
}

export function AIPlannerProvider({ children }) {
  const { selectedDistrict, selectedTa } = useDistrict();
  const defaultContext = useMemo(
    () => buildDefaultContext(selectedDistrict, selectedTa),
    [selectedDistrict, selectedTa],
  );
  const [plannerState, setPlannerState] = useState({
    isOpen: false,
    mode: "query",
    query: "",
    title: "",
    metricId: "",
    metricLabel: "",
    context: defaultContext,
    sourceRows: [],
    sourceTitle: "",
  });
  const [chatSession, setChatSession] = useState(() => Date.now());
  const [chatHistory, setChatHistory] = useState(loadChatHistory);

  const updateChatHistory = useCallback((messages) => {
    setChatHistory(messages);
    saveChatHistory(messages);
  }, []);

  const startNewConversation = useCallback(() => {
    setChatSession(Date.now());
    setChatHistory([]);
    saveChatHistory([]);
  }, []);

  const openAIPlanner = useCallback(
    ({
      mode = "query",
      query = "",
      title = "",
      metricId = "",
      metricLabel = "",
      context = {},
      sourceRows = [],
      sourceTitle = "",
    } = {}) => {
      setPlannerState((current) => ({
        ...current,
        isOpen: true,
        mode,
        query,
        title,
        metricId,
        metricLabel,
        context: {
          ...defaultContext,
          ...context,
          district: context.district ?? defaultContext.district,
          ta: context.ta ?? defaultContext.ta,
          scopeLabel: context.scopeLabel ?? defaultContext.scopeLabel,
        },
        sourceRows,
        sourceTitle,
      }));
    },
    [defaultContext],
  );

  const closeAIPlanner = useCallback(() => {
    setPlannerState((current) => ({
      ...current,
      isOpen: false,
    }));
  }, []);

  const value = useMemo(
    () => ({
      plannerState,
      openAIPlanner,
      closeAIPlanner,
      chatSession,
      chatHistory,
      updateChatHistory,
      startNewConversation,
    }),
    [plannerState, openAIPlanner, closeAIPlanner, chatSession, chatHistory, updateChatHistory, startNewConversation],
  );

  return (
    <AIPlannerContext.Provider value={value}>
      {children}
    </AIPlannerContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAIPlanner() {
  const context = useContext(AIPlannerContext);

  if (!context) {
    return {
      plannerState: {
        isOpen: false,
        mode: "query",
        query: "",
        title: "",
        metricId: "",
        metricLabel: "",
        context: buildDefaultContext(),
        sourceRows: [],
        sourceTitle: "",
      },
      openAIPlanner: () => {},
      closeAIPlanner: () => {},
      chatSession: 0,
      chatHistory: [],
      updateChatHistory: () => {},
      startNewConversation: () => {},
    };
  }

  return context;
}
