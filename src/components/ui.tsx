import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function ModalShell({
  eyebrow,
  title,
  labelId,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  labelId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="modal-heading">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 id={labelId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="heading-actions">{action}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: string;
  foot: ReactNode;
  icon: ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <i className="metric-icon">{icon}</i>
      </div>
      <strong className="metric-value">{value}</strong>
      <small className="metric-foot">{foot}</small>
    </article>
  );
}

export function EmptyPanel({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-panel">
      <i className="metric-icon">{icon}</i>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ProgressRow({
  label,
  detail,
  progress,
}: {
  label: string;
  detail: ReactNode;
  progress: number;
}) {
  const width = Math.min(100, Math.max(0, progress));
  return (
    <div className="budget-row">
      <div className="budget-meta">
        <span className="budget-name">{label}</span>
        <span className="budget-numbers">{detail}</span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
