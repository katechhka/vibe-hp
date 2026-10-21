'use client';
import Link from 'next/link';
export function PrivacyConsent({
  checked,
  onChange,
  disabled,
  id,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id: string;
  error?: string;
}) {
  return (
    <div className="privacy-consent">
      <label htmlFor={id}>
        <input
          id={id}
          name="privacyConsent"
          type="checkbox"
          required
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : undefined}
        />
        <span>
          Даю{' '}
          <Link href="/consent" target="_blank" rel="noopener noreferrer">
            согласие на обработку персональных данных
          </Link>{' '}
          и ознакомлен(а) с{' '}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer">
            политикой обработки данных
          </Link>
          .
        </span>
      </label>
      {error && (
        <p id={id + '-error'} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
