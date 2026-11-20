export default function EmotionMark({ index }: { index: number }) {
  const paths = [
    "M8 13c2-3 3 3 5 0s3 3 5 0",
    "M8 11h10M8 15h10",
    "M9 15c2-3 5-3 7 0",
    "M8 13h3m4 0h3",
    "M11 10a2 2 0 0 1 4 0c0 2-2 2-2 4m0 3v.1",
  ];
  return (
    <svg viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="10" fill="currentColor" opacity=".12" />
      <circle cx="13" cy="13" r="9.5" stroke="currentColor" strokeWidth="1.2" />
      <path d={paths[index]} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {index === 2 && (
        <>
          <circle cx="9" cy="10" r=".8" fill="currentColor" />
          <circle cx="17" cy="10" r=".8" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
