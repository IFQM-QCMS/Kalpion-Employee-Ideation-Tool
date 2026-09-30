import { useRef, useEffect } from 'react';

/*
 * Six separate boxes for a one-time code, rather than one text field - auto-advances as each
 * digit lands, take a full pasted code in one go, and backspace walks back through empty
 * boxes instead of stopping at the first one. Controlled: `value` is the whole code as a
 * string, `onChange` receives the whole code back on every keystroke.
 */
export default function OtpInput({
  value, onChange, length = 6, disabled = false, autoFocus = true, error = false, label = 'Verification code',
}) {
  const boxRefs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus) boxRefs.current[0]?.focus();
    // Only on mount - refocusing on every value change would fight the user's own cursor.
    /* eslint-disable-next-line */
  }, []);

  function setDigitAt(i, char) {
    const next = digits.slice();
    next[i] = char;
    onChange(next.join(''));
  }

  function handleChange(i, raw) {
    const chars = raw.replace(/\D/g, '');
    if (!chars) { setDigitAt(i, ''); return; }
    // A paste can land in any box, not only the first - spread across from here.
    if (chars.length > 1) {
      const next = digits.slice();
      for (let k = 0; k < chars.length && i + k < length; k++) next[i + k] = chars[k];
      onChange(next.join(''));
      const landing = Math.min(i + chars.length, length - 1);
      boxRefs.current[landing]?.focus();
      return;
    }
    setDigitAt(i, chars);
    if (i < length - 1) boxRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace') {
      if (digits[i]) { setDigitAt(i, ''); return; }
      if (i > 0) { e.preventDefault(); boxRefs.current[i - 1]?.focus(); setDigitAt(i - 1, ''); }
      return;
    }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxRefs.current[i - 1]?.focus(); }
    if (e.key === 'ArrowRight' && i < length - 1) { e.preventDefault(); boxRefs.current[i + 1]?.focus(); }
  }

  function handlePaste(i, e) {
    const text = e.clipboardData.getData('text');
    if (!/\d/.test(text)) return;
    e.preventDefault();
    handleChange(i, text);
  }

  return (
    <div className="ifqm-otp-boxes" role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { boxRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={length /* a paste is handled in onChange before the browser can clip it */}
          value={d}
          disabled={disabled}
          aria-label={`${label}, digit ${i + 1} of ${length}`}
          aria-invalid={error || undefined}
          className={`ifqm-otp-box${error ? ' is-error' : ''}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
