import { Link } from "react-router-dom";
import { CodeExample } from "../../components/CodeExample/CodeExample";
import { TrustedCourseContent } from "../../components/TrustedCourseContent/TrustedCourseContent";
import type { TheoryArticleModel } from "../../types/content";

type Props = {
  article: TheoryArticleModel;
  /** Legacy stage intro embeds article without «к первому этапу» CTA. */
  showCta?: boolean;
};

export function TheoryArticleBody({ article, showCta = true }: Props) {
  if (article.kind === "teaser") {
    return (
      <>
        <div className="pane">
          <div className="theory-body">
            <TrustedCourseContent html={article.teaserHtml} />
          </div>
          {article.exampleCode ? <CodeExample code={article.exampleCode} /> : null}
        </div>
        {showCta ? <TheoryCta firstTaskId={article.firstTaskId} /> : null}
      </>
    );
  }

  return (
    <>
      {article.leadHtml ? (
        <TrustedCourseContent
          as="p"
          html={article.leadHtml}
          className="theory-lead"
        />
      ) : null}

      {article.sections.map((section, sectionIndex) => {
        const headingId = `theory-section-${sectionIndex}`;
        return (
          <section
            key={headingId}
            className="theory-section pane"
            aria-labelledby={headingId}
          >
            <h2 id={headingId}>{section.title}</h2>
            <div className="theory-body">
              {section.paragraphsHtml.map((html, i) => (
                <TrustedCourseContent
                  key={i}
                  html={html}
                  style={{ display: "contents" }}
                />
              ))}
            </div>
            {section.examples.map((example, exampleIndex) => (
              <div key={exampleIndex}>
                <CodeExample code={example.code} />
                {example.explanationHtml ? (
                  <TrustedCourseContent
                    as="p"
                    html={example.explanationHtml}
                    className="stage-ex-note"
                  />
                ) : null}
              </div>
            ))}
          </section>
        );
      })}

      {article.mistakes.length > 0 ? (
        <section className="theory-mistakes pane" aria-labelledby="theory-mistakes-h">
          <h2 id="theory-mistakes-h">Типичные ошибки</h2>
          {article.mistakes.map((mistake, i) => (
            <p key={i}>
              <b>{mistake.title}.</b>{" "}
              <TrustedCourseContent as="span" html={mistake.textHtml} />
            </p>
          ))}
        </section>
      ) : null}

      {article.applicationsHtml.length > 0 ? (
        <section className="theory-apps pane" aria-labelledby="theory-apps-h">
          <h2 id="theory-apps-h">Где применяется</h2>
          <ul>
            {article.applicationsHtml.map((html, i) => (
              <li key={i}>
                <TrustedCourseContent
                  as="span"
                  html={html}
                  style={{ display: "contents" }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {article.summaryHtml.length > 0 ? (
        <section className="theory-summary pane" aria-labelledby="theory-summary-h">
          <h2 id="theory-summary-h">Кратко</h2>
          <ul>
            {article.summaryHtml.map((html, i) => (
              <li key={i}>
                <TrustedCourseContent
                  as="span"
                  html={html}
                  style={{ display: "contents" }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {article.prevLabel || article.nextLabel ? (
        <p className="theory-nav-links">
          {article.prevLabel ? <span>{article.prevLabel}</span> : null}
          {article.nextLabel ? <span>{article.nextLabel}</span> : null}
        </p>
      ) : null}

      {showCta ? <TheoryCta firstTaskId={article.firstTaskId} /> : null}
    </>
  );
}

function TheoryCta({ firstTaskId }: { firstTaskId: string | null }) {
  const to = firstTaskId ? `/task/${firstTaskId}` : "/task/";
  return (
    <div className="stage-cta">
      <Link className="btn dark big" to={to}>
        К первому этапу →
      </Link>
    </div>
  );
}
