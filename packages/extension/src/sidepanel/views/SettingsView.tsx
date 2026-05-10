import { useState, useMemo } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error';

export function SettingsView() {
  const setView = useStore((s) => s.setView);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);
  const [connStatus, setConnStatus] = useState<ConnStatus>('idle');
  const [saved, setSaved] = useState(false);

  const dirty = backendUrl !== settings.backendUrl;

  const urlError = useMemo(() => {
    if (!backendUrl) return null;
    try {
      const url = new URL(backendUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return 'URL must use http or https.';
      return null;
    } catch {
      return 'Not a valid URL.';
    }
  }, [backendUrl]);

  async function handleTestConnection() {
    setConnStatus('testing');
    try {
      const res = await fetch(`${backendUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      setConnStatus(res.ok ? 'ok' : 'error');
    } catch {
      setConnStatus('error');
    }
    setTimeout(() => setConnStatus('idle'), 3000);
  }

  function handleSave() {
    setSettings({ backendUrl });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
        <h2 className="font-semibold">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Backend URL field */}
        <div>
          <label className="block text-xs font-medium mb-1">Backend URL</label>
          <input
            type="url"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="http://localhost:8765"
            className="w-full text-sm px-2 py-1.5 rounded-md border border-border bg-input-background"
            style={{ fontFamily: 'var(--font-mono)', borderColor: urlError ? 'var(--status-failed)' : undefined }}
          />
          {urlError ? (
            <p className="text-[11px] mt-1" style={{ color: 'var(--status-failed)' }}>{urlError}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-1">
              Where the lale FastAPI service is running.
            </p>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleTestConnection()}
            loading={connStatus === 'testing'}
            disabled={!!urlError || !backendUrl}
          >
            Test connection
          </Button>
          {connStatus === 'ok' ? (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--status-verified)' }}>
              <CheckCircle2 size={13} /> Connected
            </span>
          ) : connStatus === 'error' ? (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--status-failed)' }}>
              <XCircle size={13} /> Unreachable
            </span>
          ) : connStatus === 'testing' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Testing…
            </span>
          ) : null}
        </div>

        {/* API key info */}
        <div className="rounded-md border border-border p-3 bg-muted/30">
          <div className="lale-section-label">Anthropic key</div>
          <p className="text-xs">
            Set <code style={{ fontFamily: 'var(--font-mono)' }}>ANTHROPIC_API_KEY</code> in the
            backend environment. The extension never sees the key — translation happens server-side.
          </p>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border bg-card shrink-0 flex justify-end gap-2">
        <Button
          variant="primary"
          disabled={!dirty || !!urlError}
          onClick={handleSave}
        >
          Save
        </Button>
      </div>

      {/* Save toast */}
      {saved ? (
        <div
          className="lale-toast fixed bottom-5 left-1/2 text-xs px-4 py-2 rounded-full shadow-md font-medium"
          style={{ backgroundColor: 'var(--status-verified)', color: '#fff' }}
        >
          Settings saved
        </div>
      ) : null}
    </div>
  );
}
