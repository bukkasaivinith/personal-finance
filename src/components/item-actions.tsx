import { useState } from 'react';
import { Pencil, Power, PowerOff, RotateCcw, Trash2 } from 'lucide-react';
import { ModalShell } from '@/components/ui';
import type { ItemState } from '@/lib/finance';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function StatusTag({ state }: { state: ItemState }) {
  if (state === 'active') return null;
  return <span className={`status-tag ${state}`}>{state === 'inactive' ? 'Inactive' : 'Deleted'}</span>;
}

type Pending = 'delete' | 'purge';

export function ItemActions({
  name,
  state,
  usageCount,
  onEdit,
  onSetState,
  onDeletePermanently,
}: {
  name: string;
  state: ItemState;
  usageCount: number;
  onEdit?: () => void;
  onSetState: (state: ItemState) => Promise<void>;
  onDeletePermanently: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      setPending(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => run(() => onSetState('deleted'));
  const confirmPurge = () => run(onDeletePermanently);

  return (
    <>
      <div className="item-actions">
        {onEdit && state !== 'deleted' ? (
          <button className="ghost-button" type="button" onClick={onEdit}>
            <Pencil size={14} /> Edit
          </button>
        ) : null}
        {state === 'active' ? (
          <button className="ghost-button" type="button" onClick={() => void run(() => onSetState('inactive'))} disabled={busy}>
            <PowerOff size={14} /> Deactivate
          </button>
        ) : null}
        {state === 'inactive' ? (
          <button className="ghost-button" type="button" onClick={() => void run(() => onSetState('active'))} disabled={busy}>
            <Power size={14} /> Activate
          </button>
        ) : null}
        {state === 'deleted' ? (
          <button className="ghost-button" type="button" onClick={() => void run(() => onSetState('active'))} disabled={busy}>
            <RotateCcw size={14} /> Restore
          </button>
        ) : null}
        {state !== 'deleted' ? (
          <button className="ghost-button danger" type="button" onClick={() => setPending('delete')} disabled={busy}>
            <Trash2 size={14} /> Delete
          </button>
        ) : null}
        {state === 'deleted' && usageCount === 0 ? (
          <button className="ghost-button danger" type="button" onClick={() => setPending('purge')} disabled={busy}>
            <Trash2 size={14} /> Delete permanently
          </button>
        ) : null}
      </div>

      {pending ? (
        <ConfirmDialog
          title={pending === 'purge' ? `Delete ${name} permanently?` : `Delete ${name}?`}
          message={
            pending === 'purge'
              ? 'This removes it completely. It has no transactions, so no history is lost. This cannot be undone.'
              : usageCount > 0
                ? `${name} is used by ${usageCount} ${usageCount === 1 ? 'transaction' : 'transactions'}. It will leave active use and new entries, but those transactions and their history stay in place. You can restore it from the deleted list.`
                : `${name} will leave active use. You can restore it from the deleted list at any time.`
          }
          confirmLabel={pending === 'purge' ? 'Delete permanently' : 'Delete'}
          busy={busy}
          error={error}
          onConfirm={pending === 'purge' ? confirmPurge : confirmDelete}
          onCancel={() => {
            setPending(null);
            setError('');
          }}
        />
      ) : null}
      {!pending && error ? <p className="form-error">{error}</p> : null}
    </>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell eyebrow="Confirm" title={title} labelId="confirm-dialog-title" onClose={onCancel}>
      <div className="modal-form">
        <p className="modal-description">{message}</p>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>
            Keep it
          </button>
          <button className="primary-button danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
