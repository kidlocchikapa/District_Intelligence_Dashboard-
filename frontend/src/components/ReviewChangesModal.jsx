import { useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import Modal from "./Modal";

function tryParseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeObject(value) {
  const parsed = tryParseJson(value);
  return isPlainObject(parsed) ? parsed : {};
}

function normalizeFieldKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function buildCanonicalLookup(value) {
  const lookup = new Map();
  const object = normalizeObject(value);

  Object.entries(object).forEach(([key, entryValue]) => {
    lookup.set(key, entryValue);
    lookup.set(normalizeFieldKey(key), entryValue);
  });

  return lookup;
}

function getLookupValue(object, lookup, key) {
  if (!isPlainObject(object)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(object, key)) {
    return object[key];
  }

  const normalizedKey = normalizeFieldKey(key);
  if (lookup.has(normalizedKey)) {
    return lookup.get(normalizedKey);
  }

  for (const [existingKey, value] of Object.entries(object)) {
    if (normalizeFieldKey(existingKey) === normalizedKey) {
      return value;
    }
  }

  return null;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function sameValue(left, right) {
  const normalizedLeft = tryParseJson(left);
  const normalizedRight = tryParseJson(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function buildFieldRows(review) {
  const beforeData = normalizeObject(review?.before_data);
  const requestPayload = normalizeObject(review?.request_payload);
  const afterData = normalizeObject(review?.after_data);
  const proposedData = Object.keys(afterData).length
    ? { ...requestPayload, ...afterData }
    : requestPayload;
  const beforeLookup = buildCanonicalLookup(beforeData);
  const proposedLookup = buildCanonicalLookup(proposedData);
  const changedFieldsSource = tryParseJson(review?.changed_fields);
  const changedFields = Array.isArray(changedFieldsSource)
    ? changedFieldsSource.filter(Boolean)
    : [];
  const keys = changedFields.length
    ? changedFields
    : [...new Set([...Object.keys(beforeData), ...Object.keys(proposedData)])];

  return keys
    .map((key) => {
      const beforeValue = getLookupValue(beforeData, beforeLookup, key);
      const afterValue = getLookupValue(proposedData, proposedLookup, key);

      return {
        key,
        beforeValue,
        afterValue,
        changed: !sameValue(beforeValue, afterValue),
      };
    })
    .filter((row) => row.changed || !changedFields.length);
}

function MetaItem({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export default function ReviewChangesModal({
  review,
  onClose,
  title = "Review Preview",
  description = "Preview the submitted changes before taking action.",
  showActions = false,
  onApprove,
  onReject,
  approveLabel = "Approve",
  rejectLabel = "Reject",
}) {
  const fieldRows = useMemo(() => buildFieldRows(review), [review]);
  const changedFields = Array.isArray(review?.changed_fields)
    ? review.changed_fields.filter(Boolean)
    : [];

  const actionBanner = useMemo(() => {
    const action = String(review?.action || "").toLowerCase();

    if (action === "create") {
      return "This review will create a new record using the values shown below.";
    }

    if (action === "delete" || action === "archive") {
      return "This review will remove or deactivate the existing record shown below.";
    }

    return "This review will replace the current field values with the proposed values shown below.";
  }, [review?.action]);

  return (
    <Modal isOpen={Boolean(review)} onClose={onClose} title={title} size="xl">
      <div className="space-y-5">
        <p className="text-sm font-semibold leading-relaxed text-slate-600">
          {description}
        </p>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
          {actionBanner}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetaItem label="Table" value={review?.table_name || "-"} />
          <MetaItem label="Record ID" value={review?.record_id ?? "-"} />
          <MetaItem label="Action" value={review?.action || "-"} />
          <MetaItem label="Status" value={review?.status || "-"} />
          <MetaItem label="Submitted By" value={review?.changed_by_full_name || review?.changed_by_email || "-"} />
          <MetaItem label="Reviewed By" value={review?.reviewed_by_full_name || "-"} />
          <MetaItem label="Submitted At" value={review?.changed_at || "-"} />
          <MetaItem label="Reviewed At" value={review?.reviewed_at || "-"} />
          <MetaItem label="Changed Fields" value={changedFields.length ? changedFields.join(", ") : "-"} />
        </div>

        {review?.review_notes ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Review Notes
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-700">
              {review.review_notes}
            </p>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
            Field Changes
          </div>
          <div className="max-h-[48vh] overflow-auto bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Field
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Before
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    After
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fieldRows.length ? (
                  fieldRows.map((row) => (
                    <tr key={row.key} className="align-top">
                      <td className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-700">
                        {row.key}
                      </td>
                      <td className="px-4 py-3">
                        <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                          {formatValue(row.beforeValue)}
                        </pre>
                      </td>
                      <td className="px-4 py-3">
                        <pre className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
                          {formatValue(row.afterValue)}
                        </pre>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-10 text-center text-sm font-semibold text-slate-400"
                    >
                      No field-level differences detected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50"
          >
            Close
          </button>
          {showActions && review?.status === "pending" && (
            <>
              <button
                type="button"
                onClick={() => onReject?.(review)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 transition-all hover:border-red-700 hover:bg-red-700 hover:text-white"
              >
                <XCircle size={14} />
                {rejectLabel}
              </button>
              <button
                type="button"
                onClick={() => onApprove?.(review)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition-all hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"
              >
                <CheckCircle2 size={14} />
                {approveLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
