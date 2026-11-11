export function MelonMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="melon-mark"
      width={size}
      height={Math.round((size * 16) / 30)}
      viewBox="1 11 30 16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12a14 14 0 0 0 28 0Z" fill="var(--rind)" />
      <path d="M5 12a11 11 0 0 0 22 0Z" fill="var(--rind-light)" />
      <path d="M7 12a9 9 0 0 0 18 0Z" fill="var(--flesh)" />
      <ellipse cx="12" cy="15.5" rx="0.9" ry="1.4" fill="var(--seed)" />
      <ellipse cx="16" cy="18" rx="0.9" ry="1.4" fill="var(--seed)" />
      <ellipse cx="20" cy="15.5" rx="0.9" ry="1.4" fill="var(--seed)" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <MelonMark />
      <span className="brand-name">MelonApp</span>
    </span>
  );
}
