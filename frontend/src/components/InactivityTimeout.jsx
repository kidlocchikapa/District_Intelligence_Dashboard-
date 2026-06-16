import { useState, useEffect, useRef, useCallback } from "react";
import { setAuthToken } from "../lib/api";
import { useNavigate } from "react-router-dom";

const INACTIVITY_LIMIT = 5 * 60 * 1000;
const COUNTDOWN_SECONDS = 30;

export default function InactivityTimeout({ isAuthenticated }) {
  const [phase, setPhase] = useState("idle");
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const idleRef = useRef(null);
  const tickRef = useRef(null);
  const navigate = useNavigate();

  const clearAll = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    idleRef.current = null;
    tickRef.current = null;
  }, []);

  const startIdleTimer = useCallback(() => {
    clearAll();
    idleRef.current = setTimeout(() => {
      setPhase("countdown");
      setCountdown(COUNTDOWN_SECONDS);
    }, INACTIVITY_LIMIT);
  }, [clearAll]);

  const handleActivity = useCallback(() => {
    if (phase === "countdown") return;
    startIdleTimer();
  }, [phase, startIdleTimer]);

  useEffect(() => {
    if (!isAuthenticated) {
      setPhase("idle");
      clearAll();
      return;
    }

    startIdleTimer();

    let moveTimer;
    const throttledMove = () => {
      if (moveTimer) return;
      moveTimer = setTimeout(() => {
        moveTimer = null;
        handleActivity();
      }, 300);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, handleActivity));
    window.addEventListener("mousemove", throttledMove);

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      window.removeEventListener("mousemove", throttledMove);
      clearAll();
    };
  }, [isAuthenticated, handleActivity, startIdleTimer, clearAll]);

  useEffect(() => {
    if (phase !== "countdown") {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }

    tickRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(tickRef.current);
          setAuthToken(null);
          navigate("/login");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [phase, navigate]);

  function handleStay() {
    setPhase("idle");
    setCountdown(COUNTDOWN_SECONDS);
    clearAll();
    startIdleTimer();
  }

  if (phase !== "countdown") return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative h-12 w-12">
            <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none" stroke="#dc2626" strokeWidth="3"
                strokeDasharray={`${(countdown / COUNTDOWN_SECONDS) * 100} 100`}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-linear"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-red-600">
              {countdown}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Session Timeout</h3>
            <p className="text-sm text-slate-500">You've been inactive for 5 minutes</p>
          </div>
        </div>

        <p className="text-sm text-slate-700 mb-6">
          For security, you'll be signed out automatically. Are you still using the dashboard?
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleStay}
            className="px-6 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-semibold text-sm active:scale-95"
          >
            Yes, I'm still here
          </button>
        </div>
      </div>
    </div>
  );
}
