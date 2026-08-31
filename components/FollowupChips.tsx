/**
 * "You could ask next" — the answer's recommended follow-up questions as pill
 * buttons. Tapping one sends that question verbatim. Renders nothing when
 * there are no follow-ups, so callers can render it unconditionally.
 */

export default function FollowupChips({
  followups,
  onPick,
  disabled,
}: {
  followups: string[];
  onPick: (q: string) => void;
  disabled?: boolean;
}) {
  if (!followups || followups.length === 0) return null;

  return (
    <div className="followups" aria-label="Suggested next questions">
      <span className="followups-label">You could ask next</span>
      <div className="chip-row">
        {followups.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => onPick(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
