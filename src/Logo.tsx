/**
 * Clearpad mark: a ring (the launch) with a bonding curve rising through a
 * finish line. The curve's end dot sits just past the line: it cleared.
 */
export const LogoMark = ({ size = 32, id = "cp" }: { size?: number; id?: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-ring`} x1="4" y1="44" x2="44" y2="4" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#7938FB" />
        <stop offset="0.4" stopColor="#666DFB" />
        <stop offset="0.72" stopColor="#49C9F4" />
        <stop offset="1" stopColor="#66F3AC" />
      </linearGradient>
    </defs>
    <circle cx="24" cy="24" r="19.5" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="4" />
    <path d="M12.5 33.5 H35.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" strokeDasharray="2.5 2.5" strokeLinecap="round" />
    <path d="M12.5 33.5 C 22 33, 27 26, 31 14.5" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="3.6" strokeLinecap="round" />
    <circle cx="31.4" cy="13.6" r="3.4" fill="#66F3AC" />
  </svg>
);

export const Wordmark = () => (
  <span className="wordmark">
    <LogoMark size={30} id="hdr" />
    <span>
      clear<b>pad</b>
    </span>
  </span>
);
