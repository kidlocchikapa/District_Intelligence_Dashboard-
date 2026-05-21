import { X } from 'lucide-react';

const MODAL_SIZES = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

export default function Modal({ isOpen, onClose, title, children, size = "sm" }) {
  if (!isOpen) return null;

  const maxWidthClass = MODAL_SIZES[size] || MODAL_SIZES.sm;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div 
        className={`flex max-h-[92vh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-slate-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 truncate text-base font-bold text-slate-900 sm:text-lg">{title}</h2>
          <button 
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="min-h-0 overflow-auto p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
