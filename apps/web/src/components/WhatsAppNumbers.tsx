'use client';

import { useState, useEffect, useCallback } from 'react';
import { getDeleteToken } from '@/lib/tracker-storage';
import styles from './WhatsAppNumbers.module.css';

interface WhatsAppAlert {
  id: string;
  phone: string;
  label: string | null;
  enabled: boolean;
}

export interface WhatsAppNumbersProps {
  queryId: string;
  canEdit: boolean;
}

export function WhatsAppNumbers({ queryId, canEdit }: WhatsAppNumbersProps): React.ReactElement | null {
  const [alerts, setAlerts] = useState<WhatsAppAlert[]>([]);
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = useCallback(
    () => (typeof window !== 'undefined' ? getDeleteToken(queryId) : null),
    [queryId],
  );

  const load = useCallback(async () => {
    const t = token();
    try {
      const res = await fetch(`/api/queries/${queryId}/whatsapp`, {
        headers: t ? { 'x-delete-token': t } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) setAlerts(data.data.alerts as WhatsAppAlert[]);
    } catch {
      // Silent — the section just shows empty if the load fails.
    }
  }, [queryId, token]);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  if (!canEdit) return null;

  const add = async () => {
    if (pending || phone.trim() === '') return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/queries/${queryId}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteToken: token(), phone, label }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setPhone('');
        setLabel('');
        await load();
      } else {
        setError(data?.error ?? 'No se pudo agregar el número.');
      }
    } catch {
      setError('Error de red al agregar el número.');
    } finally {
      setPending(false);
    }
  };

  const remove = async (alertId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/queries/${queryId}/whatsapp`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteToken: token(), alertId }),
      });
      if (res.ok) await load();
    } catch {
      setError('Error de red al quitar el número.');
    }
  };

  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>📱 Alertas por WhatsApp</span>
        <span className={styles.hint}>Cuando este vuelo baje de precio, avisamos a estos números.</span>
      </div>

      {alerts.length > 0 && (
        <ul className={styles.list}>
          {alerts.map((a) => (
            <li key={a.id} className={styles.item}>
              <span className={styles.phone}>{a.phone}</span>
              {a.label && <span className={styles.label}>{a.label}</span>}
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(a.id)}
                aria-label={`Quitar ${a.phone}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.form}>
        <input
          className={styles.input}
          type="tel"
          inputMode="numeric"
          placeholder="Número (ej. 573001234567)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          className={styles.input}
          type="text"
          placeholder="Nombre (opcional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" className={styles.add} onClick={add} disabled={pending || phone.trim() === ''}>
          {pending ? 'Agregando…' : 'Agregar'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
