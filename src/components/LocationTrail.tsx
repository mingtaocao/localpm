export function LocationTrail({ parts }: { parts: string[] }) {
  if (parts.length < 2) return <span>{parts[0]}</span>;
  return (
    <>
      <span className="location-parents">{parts.slice(0, -1).join(" / ")}</span>
      <span className="location-leaf"> / {parts.at(-1)}</span>
    </>
  );
}
