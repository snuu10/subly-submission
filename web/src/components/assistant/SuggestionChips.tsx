type SuggestionChipsProps = {
  suggestions: string[];
  disabled?: boolean;
  onSelect: (text: string) => void;
  /** 'lg'는 대화가 비어있는 첫 화면에서 세로로 넓게 보여줄 때 쓴다. */
  size?: 'sm' | 'lg';
};

export function SuggestionChips({ suggestions, disabled, onSelect, size = 'sm' }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  if (size === 'lg') {
    return (
      <div className="flex flex-col gap-2.5">
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(text)}
            className="rounded-2xl border border-border bg-surface px-4 py-3 text-left text-sm font-semibold text-text hover:border-primary hover:bg-accent disabled:opacity-50"
          >
            {text}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(text)}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-bold text-text hover:border-primary disabled:opacity-50"
        >
          {text}
        </button>
      ))}
    </div>
  );
}
