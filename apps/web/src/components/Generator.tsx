import { useCallback, useEffect, useState } from 'react';
import { cryptoCall } from '../crypto/client';
import type { GeneratorOptions } from '../crypto/protocol';
import { PasswordText } from './PasswordText';

const DEFAULTS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const TOGGLES: { key: keyof Omit<GeneratorOptions, 'length'>; label: string }[] = [
  { key: 'lowercase', label: 'Kleinbuchstaben' },
  { key: 'uppercase', label: 'Großbuchstaben' },
  { key: 'digits', label: 'Ziffern' },
  { key: 'symbols', label: 'Sonderzeichen' },
  { key: 'avoidAmbiguous', label: 'Ohne verwechselbare Zeichen' },
];

export function Generator({ onUse }: { onUse: (password: string) => void }) {
  const [opts, setOpts] = useState(DEFAULTS);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (o: GeneratorOptions) => {
    try {
      setValue(await cryptoCall('generatePassword', o));
      setError(null);
    } catch {
      setError('Wähle mindestens eine Zeichenart.');
    }
  }, []);

  useEffect(() => {
    void generate(opts);
  }, [opts, generate]);

  return (
    <div className="generator">
      <div className="generator-output" aria-live="polite">
        {error ? <span className="field-error">{error}</span> : <PasswordText value={value} revealed size="lg" />}
      </div>
      <label className="generator-length">
        <span>Länge: {opts.length}</span>
        <input
          type="range"
          min={8}
          max={64}
          value={opts.length}
          onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
        />
      </label>
      <div className="generator-toggles">
        {TOGGLES.map((t) => (
          <label key={t.key} className="check">
            <input
              type="checkbox"
              checked={opts[t.key]}
              onChange={(e) => setOpts({ ...opts, [t.key]: e.target.checked })}
            />
            {t.label}
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => void generate(opts)}>
          Neu erzeugen
        </button>
        <button type="button" className="btn btn-primary" disabled={!!error || !value} onClick={() => onUse(value)}>
          Dieses Passwort verwenden
        </button>
      </div>
    </div>
  );
}
