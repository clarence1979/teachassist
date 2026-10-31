interface Props {
  size?: number;
  className?: string;
}

/** Graduation cap icon — the Teach Assist brand mark. */
export function TeachAssistIcon({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Mortarboard top */}
      <polygon points="12,3 22,8 12,13 2,8" fill="currentColor" opacity="0.95" />
      {/* Board outline highlight */}
      <polygon points="12,3 22,8 12,13 2,8" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      {/* Cap body / cylinder */}
      <path d="M6 9.5 Q6 16 12 17.5 Q18 16 18 9.5" fill="currentColor" opacity="0.35" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {/* Tassel cord */}
      <line x1="22" y1="8" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="22" cy="14.5" r="1.5" fill="currentColor" />
      {/* Pencil detail — small at bottom left */}
      <line x1="4" y1="20" x2="7" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      <circle cx="4" cy="20.5" r="1" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/** Full inline logo: icon + wordmark */
export function TeachAssistLogo({ iconSize = 18, className }: { iconSize?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <TeachAssistIcon size={iconSize} className="text-accent-cyan shrink-0" />
      <span className="font-orbitron font-bold tracking-widest text-accent-cyan leading-none">
        TEACH ASSIST
      </span>
    </span>
  );
}
