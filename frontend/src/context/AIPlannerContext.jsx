import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useDistrict } from "./DistrictContext";

const AIPlannerContext = createContext(null);

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
    }),
    [plannerState, openAIPlanner, closeAIPlanner],
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
    };
  }

  return context;
}
