export default function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 26V15M16 20C7 21 4 15 5 7c8 0 12 5 11 13Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 15C15 7 20 3 27 4c1 8-4 13-11 11Z" fill="currentColor" />
      <path
        d="m16 15 6-6"
        stroke="var(--mark-vein, #f8faf5)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
