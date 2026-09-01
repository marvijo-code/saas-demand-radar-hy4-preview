import type { NeedTrendPoint } from '@sdr/shared';
import type { ScoreComponent } from '../lib/api.ts';
import { formatScore, trendLabel } from '../lib/format.tsx';

/**
 * Bar chart of how much evidence appeared in each bucket of the selected window.
 * Rendered with plain divs so it scales, needs no chart library and stays readable at 390px.
 */
export function TrendChart({ points }: { points: NeedTrendPoint[] }) {
  if (!points.length) {
    return <p className="muted">No evidence in this window.</p>;
  }
  const max = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  return (
    <div className="trend">
      <div className="trend__chart" role="img" aria-label={`Evidence over time, ${total} records total`}>
        {points.map((point) => (
          <div className="trend__column" key={point.date}>
            <div
              className="trend__bar"
              style={{ height: `${Math.round((point.count / max) * 100)}%` }}
              title={`${trendLabel(point.date)}: ${point.count}`}
            />
          </div>
        ))}
      </div>
      <div className="trend__axis" aria-hidden="true">
        <span>{trendLabel(points[0].date)}</span>
        <span>{trendLabel(points[points.length - 1].date)}</span>
      </div>
      <p className="muted">
        {total} evidence record{total === 1 ? '' : 's'} in this window · peak {max} per bucket
      </p>
    </div>
  );
}

/** The "why" behind a score: every component, its weight, its points and its raw measurement. */
export function ScoreExplanation({
  components,
  explanation,
  basePoints,
  phraseMultiplier,
  sourceMultiplier,
  feedbackMultiplier,
  bonusPoints,
}: {
  components: ScoreComponent[];
  explanation: string[];
  basePoints: number;
  phraseMultiplier: number;
  sourceMultiplier: number;
  feedbackMultiplier: number;
  bonusPoints: number;
}) {
  return (
    <div className="score-explanation">
      <table className="table">
        <caption className="sr-only">Score components and their contribution</caption>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Measured</th>
            <th scope="col">Weight</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component.key}>
              <th scope="row">
                {component.label}
                <span className="table__detail">{component.detail}</span>
              </th>
              <td>{Math.round(component.value * 100)}%</td>
              <td>{Math.round(component.weight * 100)}%</td>
              <td>{formatScore(component.points)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Weighted base score</th>
            <td colSpan={2} />
            <td>{formatScore(basePoints)}</td>
          </tr>
        </tfoot>
      </table>

      <ul className="multiplier-list">
        <li>
          <span>Phrase multiplier</span>
          <strong>×{phraseMultiplier}</strong>
        </li>
        <li>
          <span>Source multiplier</span>
          <strong>×{sourceMultiplier}</strong>
        </li>
        <li>
          <span>Feedback multiplier</span>
          <strong>×{feedbackMultiplier}</strong>
        </li>
        <li>
          <span>Outcome bonus</span>
          <strong>+{formatScore(bonusPoints)}</strong>
        </li>
      </ul>

      <ol className="explanation-list">
        {explanation.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
      </ol>
    </div>
  );
}
