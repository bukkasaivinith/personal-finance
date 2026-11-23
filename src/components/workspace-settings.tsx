import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteCurrentFinanceAccount } from '@/lib/auth-api';

export function WorkspaceSettings() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const deleteAccount = async () => {
    if (deleting || !window.confirm('Permanently delete your account and all your workspace records? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deleteCurrentFinanceAccount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete your account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="surface-card workspace-danger-card">
      <div>
        <h3>Delete my account</h3>
        <p>This permanently deletes your account and workspace records.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <button className="primary-button danger" type="button" disabled={deleting} onClick={() => void deleteAccount()}>
        {deleting ? 'Deleting…' : <><Trash2 size={15} /> Delete account</>}
      </button>
    </section>
  );
}
