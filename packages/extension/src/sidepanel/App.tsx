import { useEffect } from 'react';
import { useStore } from './store';
import { MainView } from './views/MainView';
import { DependencyView } from './views/DependencyView';
import { VerifyingView } from './views/VerifyingView';
import { SuccessView } from './views/SuccessView';
import { FailureView } from './views/FailureView';
import { SettingsView } from './views/SettingsView';

export function App() {
  const view = useStore((s) => s.view);
  const errorMessage = useStore((s) => s.errorMessage);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    if (!errorMessage) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [errorMessage, setError]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === 'main' && <MainView />}
        {view === 'dependency' && <DependencyView />}
        {view === 'verifying' && <VerifyingView />}
        {view === 'success' && <SuccessView />}
        {view === 'failure' && <FailureView />}
        {view === 'settings' && <SettingsView />}
      </div>
      {errorMessage ? (
        <div
          className="px-3 py-2 text-xs border-t border-border"
          style={{ backgroundColor: 'var(--status-failed-bg)', color: 'var(--status-failed)' }}
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
