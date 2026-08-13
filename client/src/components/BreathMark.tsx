/**
 * סמל "מרחב" — שלוש טבעות נשימה קונצנטריות סביב נקודה.
 * החוץ מתרחב, המרכז נשאר. זה כל הרעיון.
 */
export default function BreathMark({
  className = "",
  animate = false,
}: {
  className?: string;
  animate?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={className}
      role="presentation">
      <circle
        cx="20"
        cy="20"
        r="18"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.18"
        className={animate ? "merhav-ring merhav-ring-1" : undefined}
      />
      <circle
        cx="20"
        cy="20"
        r="12"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.32"
        className={animate ? "merhav-ring merhav-ring-2" : undefined}
      />
      <circle
        cx="20"
        cy="20"
        r="6"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.55"
        className={animate ? "merhav-ring merhav-ring-3" : undefined}
      />
      <circle cx="20" cy="20" r="1.9" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
