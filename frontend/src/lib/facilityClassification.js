const FACILITY_TYPE_RULES = [
  {
    category: "hospital",
    label: "Hospital",
    matcher: /\bhospital\b/i,
  },
  {
    category: "health_centre",
    label: "Health Centre",
    matcher: /health\s*(centre|center)/i,
  },
  {
    category: "clinic",
    label: "Clinic",
    matcher: /\bclinic\b/i,
  },
  {
    category: "dispensary",
    label: "Dispensary",
    matcher: /\bdispensary\b/i,
  },
  {
    category: "health_post",
    label: "Health Post",
    matcher: /health\s*post/i,
  },
];

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveRawType(properties = {}) {
  return (
    properties?.type ||
    properties?.facility_type ||
    properties?.facility_category ||
    properties?.service_type ||
    ""
  );
}

export function classifyFacilityType(typeValue) {
  const rawType = String(typeValue || "").trim();
  const normalizedType = rawType.toLowerCase();

  const matchedRule = FACILITY_TYPE_RULES.find((rule) =>
    rule.matcher.test(normalizedType),
  );

  if (matchedRule) {
    return {
      category: matchedRule.category,
      label: matchedRule.label,
      isHospital: matchedRule.category === "hospital",
      rawType: rawType || "Unspecified",
    };
  }

  return {
    category: "other",
    label: rawType ? toTitleCase(rawType) : "Other",
    isHospital: false,
    rawType: rawType || "Unspecified",
  };
}

export function classifyFacilityProperties(properties = {}) {
  return classifyFacilityType(resolveRawType(properties));
}

export function isHospitalFacility(properties = {}) {
  return classifyFacilityProperties(properties).isHospital;
}
