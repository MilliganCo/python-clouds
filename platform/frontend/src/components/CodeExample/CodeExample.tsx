type Props = {
  code: string;
  label?: string;
};

export function CodeExample({ code, label = "пример.py" }: Props) {
  return (
    <div className="terminal-glass readonly">
      <div className="terminal-label-bar">
        <span className="terminal-title">{label}</span>
      </div>
      <pre className="terminal-body" aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
