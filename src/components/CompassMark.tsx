import React from "react";

/**
 * The mark. A needle on a gold disc.
 * Drawn rather than set in an emoji, so it sits on the palette and scales cleanly.
 */
export const CompassMark: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    style={{ flexShrink: 0, display: "block" }}
  >
    <circle cx="12" cy="12" r="12" fill="var(--accent)" />
    <path d="M15.4 8.6 10.9 10.9 8.6 15.4 13.1 13.1Z" fill="#2C303A" />
  </svg>
);
