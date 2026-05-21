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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div 
        className={`flex max-h-[92vh] w-full ${maxWidthClass} flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 animate-in fade-in zoom-in duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button 
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="min-h-0 overflow-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
