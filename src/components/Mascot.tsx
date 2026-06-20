type Props = {
  mode: "speaking" | "listening" | "idle";
  face?: "smile" | "x" | "surprised";
  size?: number;
};

export function Mascot({ mode, face = "smile", size = 160 }: Props) {
  const eyeY = mode === "listening" ? 54 : 56;
  const showBlush = face === "smile";
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {mode === "listening" && (
        <>
          <span
            className="absolute inset-0 rounded-full animate-mic-ripple"
            style={{ background: "var(--color-elder-sky)" }}
          />
          <span
            className="absolute inset-0 rounded-full animate-mic-ripple"
            style={{ background: "var(--color-elder-sky)", animationDelay: "0.5s" }}
          />
        </>
      )}
      <div
        className={
          mode === "speaking"
            ? "animate-mascot-pulse"
            : "animate-mascot-breathe"
        }
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
          {/* soft shadow */}
          <ellipse cx="60" cy="108" rx="38" ry="5" fill="rgba(36,31,26,0.08)" />
          {/* body */}
          <path
            d="M60 14
               C 88 14, 104 34, 104 60
               C 104 88, 86 104, 60 104
               C 34 104, 16 88, 16 60
               C 16 34, 32 14, 60 14 Z"
            fill="var(--color-elder-coral)"
          />
          {/* cheek highlight — only when smiling */}
          {showBlush && (
            <>
              <ellipse cx="44" cy="72" rx="9" ry="5" fill="#FBC7B0" opacity="0.85" />
              <ellipse cx="78" cy="72" rx="9" ry="5" fill="#FBC7B0" opacity="0.85" />
            </>
          )}
          {/* eyes */}
          {face === "x" ? (
            <>
              <line x1="40" y1="50" x2="52" y2="62" stroke="#241F1A" strokeWidth="4" strokeLinecap="round" />
              <line x1="52" y1="50" x2="40" y2="62" stroke="#241F1A" strokeWidth="4" strokeLinecap="round" />
              <line x1="68" y1="50" x2="80" y2="62" stroke="#241F1A" strokeWidth="4" strokeLinecap="round" />
              <line x1="80" y1="50" x2="68" y2="62" stroke="#241F1A" strokeWidth="4" strokeLinecap="round" />
            </>
          ) : face === "surprised" ? (
            <>
              <circle cx="46" cy="56" r="7" fill="#241F1A" />
              <circle cx="74" cy="56" r="7" fill="#241F1A" />
              <circle cx="48" cy="54" r="2" fill="#fff" />
              <circle cx="76" cy="54" r="2" fill="#fff" />
            </>
          ) : (
            <>
              {/* smile: closed crescent eyes always */}
              <path d="M40 56 Q46 50 52 56" stroke="#241F1A" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              <path d="M68 56 Q74 50 80 56" stroke="#241F1A" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            </>
          )}
          {/* mouth */}
          {face === "x" ? (
            <>
              <line x1="54" y1="74" x2="66" y2="84" stroke="#241F1A" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="66" y1="74" x2="54" y2="84" stroke="#241F1A" strokeWidth="3.5" strokeLinecap="round" />
            </>
          ) : face === "surprised" ? (
            <circle cx="60" cy="80" r="5.5" fill="none" stroke="#241F1A" strokeWidth="3" />
          ) : (
            <path d="M52 76 Q60 84 68 76" stroke="#241F1A" strokeWidth="3.5" strokeLinecap="round" fill="none" />
          )}
        </svg>
      </div>
    </div>
  );
}
