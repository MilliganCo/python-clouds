import { useEffect, useState } from "react";
import { apiPost } from "../../services/api";
import { showToast } from "../../services/toast";

export type SurveyAnswers = {
  experience?: string;
  goal?: string;
  known?: string[];
  style?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const EXPERIENCE = [
  "Никогда не программировал(а)",
  "Знаю основы",
  "Пишу код уверенно",
] as const;

const GOALS = ["Учёба", "Работа и карьера", "Для себя"] as const;

const KNOWN = [
  "переменные",
  "циклы",
  "функции",
  "ООП",
  "ничего из этого",
] as const;

const STYLES = ["Сначала теория", "Сразу практика"] as const;

function parseSurveyOk(value: unknown): { ok: true } {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === true
  ) {
    return { ok: true };
  }
  throw new Error("Invalid /api/survey response");
}

/**
 * Legacy `#quizModal` — experience survey right after registration.
 */
export function OnboardingQuiz({ open, onClose }: Props) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});

  useEffect(() => {
    if (!open) return;
    setAnswers({});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function pickSingle(
    key: keyof SurveyAnswers,
    value: string,
  ) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function toggleKnown(value: string) {
    setAnswers((prev) => {
      const cur = new Set(prev.known ?? []);
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      return { ...prev, known: [...cur] };
    });
  }

  async function finish() {
    try {
      await apiPost("/api/survey", { answers }, parseSurveyOk);
    } catch {
      /* not critical */
    }
    if (answers.experience === "Пишу код уверенно") {
      showToast("Совет: откройте «Темы» и выберите средний уровень.");
    }
    onClose();
  }

  return (
    <div
      className={`quiz-modal${open ? " open" : ""}`}
      id="quizModal"
      hidden={!open}
      aria-hidden={open ? "false" : "true"}
      role="dialog"
      aria-labelledby="quizTitle"
    >
      <div className="quiz-card">
        <h2 id="quizTitle">Пара вопросов о вас</h2>
        <p className="quiz-sub">
          Подстроим курс под ваш опыт. Это займёт 20 секунд, можно пропустить.
        </p>

        <div className="quiz-q">
          <p className="quiz-label">Опыт в программировании</p>
          <div className="quiz-opts" data-q="experience">
            {EXPERIENCE.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "quiz-opt" + (answers.experience === v ? " selected" : "")
                }
                onClick={() => pickSingle("experience", v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="quiz-q">
          <p className="quiz-label">Зачем учите Python</p>
          <div className="quiz-opts" data-q="goal">
            {GOALS.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "quiz-opt" + (answers.goal === v ? " selected" : "")
                }
                onClick={() => pickSingle("goal", v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="quiz-q">
          <p className="quiz-label">
            Что уже знакомо{" "}
            <span className="quiz-hint">(можно несколько)</span>
          </p>
          <div className="quiz-opts multi" data-q="known">
            {KNOWN.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "quiz-opt" +
                  ((answers.known ?? []).includes(v) ? " selected" : "")
                }
                onClick={() => toggleKnown(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="quiz-q">
          <p className="quiz-label">Как вам удобнее учиться</p>
          <div className="quiz-opts" data-q="style">
            {STYLES.map((v) => (
              <button
                key={v}
                type="button"
                className={
                  "quiz-opt" + (answers.style === v ? " selected" : "")
                }
                onClick={() => pickSingle("style", v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="quiz-actions">
          <button
            type="button"
            className="btn dark"
            id="quizDone"
            onClick={() => void finish()}
          >
            Готово
          </button>
          <button
            type="button"
            className="link-btn"
            id="quizSkip"
            onClick={onClose}
          >
            Пропустить
          </button>
        </div>
      </div>
    </div>
  );
}
