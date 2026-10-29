import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SafeMarkdown } from "../../components/SafeMarkdown/SafeMarkdown";

type Props = {
  open: boolean;
  points: number;
  /** Task flow: next task id under `/task/:id`. Ignored if `nextPath` set. */
  nextId?: string | null;
  /** Absolute in-app path for project / custom next. */
  nextPath?: string | null;
  xpLabel?: string;
  title?: string;
  message?: string;
  nextLabel?: string;
  stayLabel?: string;
  reviewText: string | null;
  reviewPending: boolean;
  onClose: () => void;
};

/**
 * Legacy `#successModal` — XP burst + next / stay after solve.
 */
export function SuccessModal({
  open,
  points,
  nextId = null,
  nextPath = null,
  xpLabel,
  title,
  message,
  nextLabel,
  stayLabel = "Остаться и потренироваться",
  reviewText,
  reviewPending,
  onClose,
}: Props) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hasNext = !!(nextPath || nextId);

  function goNext() {
    onClose();
    if (nextPath) navigate(nextPath);
    else navigate(nextId ? `/task/${nextId}` : "/");
  }

  const displayXp = xpLabel ?? `+${points} XP`;
  const displayTitle = title ?? "Задание решено!";
  const displayMsg =
    message ??
    (hasNext
      ? "Задание принято. Можно перейти дальше или остаться и попробовать ещё варианты."
      : "Отлично! Это последнее задание в текущем списке.");
  const displayNext =
    nextLabel ?? (hasNext ? "Следующий этап" : "К списку тем");

  return (
    <div
      className={`success-modal${open ? " open" : ""}`}
      id="successModal"
      hidden={!open}
      aria-hidden={open ? "false" : "true"}
      role="dialog"
      aria-labelledby="successTitle"
    >
      <div className="success-card">
        <div className="success-burst" aria-hidden="true" />
        <div className="success-xp" id="successXp">
          {displayXp}
        </div>
        <h2 id="successTitle">{displayTitle}</h2>
        <p className="success-msg" id="successMsg">
          {displayMsg}
        </p>
        {(reviewPending || reviewText) && (
          <div className="success-review" id="successReview">
            {reviewText ? (
              <SafeMarkdown source={reviewText} />
            ) : (
              <span className="review-wait">
                <span className="thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>✎ наставник смотрит вашу попытку…</span>
              </span>
            )}
          </div>
        )}
        <div className="success-actions">
          <button
            type="button"
            className="btn dark"
            id="successNext"
            onClick={goNext}
          >
            {displayNext}
          </button>
          <button
            type="button"
            className="btn"
            id="successStay"
            onClick={onClose}
          >
            {stayLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
