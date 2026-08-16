import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((msg, type = 'info', duration = 3200) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts }) {
  const colors  = { success: '#10b981', danger: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  const icons   = { success: 'OK', danger: '!', warning: '!', info: 'i' };

  if (!toasts.length) return null;
  return (
    <div style={{
      position: 'fixed', top: 22, right: 22, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const color = colors[t.type] || colors.info;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return (
          <div key={t.id} style={{
            background: isDark ? '#1e293b' : '#fff',
            borderLeft: `4px solid ${color}`,
            color: isDark ? '#e2e8f0' : '#0f172a',
            padding: '12px 18px 12px 14px',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.08)',
            fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 10,
            pointerEvents: 'auto', maxWidth: 340,
            animation: 'fadeInRight .28s cubic-bezier(.4,0,.2,1)',
            fontFamily: 'Inter,system-ui,sans-serif',
          }}>
            <span style={{ fontSize: 16, color }}>{icons[t.type] || icons.info}</span>
            <span dangerouslySetInnerHTML={{ __html: t.msg }} />
          </div>
        );
      })}
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
