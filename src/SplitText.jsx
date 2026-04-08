export default function SplitText({
  text = '',
  className = '',
  mode = 'chars',
  delayStep = 0.03,
}) {
  const units = mode === 'words'
    ? text.split(/(\s+)/)
    : Array.from(text);

  return (
    <span className={`split-text ${className}`.trim()} role="text" aria-label={text}>
      {units.map((unit, index) => (
        <span
          key={`${unit}-${index}`}
          aria-hidden="true"
          className="split-text-unit"
          style={{ '--split-delay': `${index * delayStep}s` }}
        >
          {unit === ' ' ? '\u00A0' : unit}
        </span>
      ))}
    </span>
  );
}
