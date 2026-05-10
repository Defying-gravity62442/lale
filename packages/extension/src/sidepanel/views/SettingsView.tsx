import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';

export function SettingsView() {
  const setView = useStore((s) => s.setView);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);

  const dirty = backendUrl !== settings.backendUrl;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
        <h2 className="font-semibold">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <div>
          <label className="block text-xs font-medium mb-1">Backend URL</label>
          <input
            type="url"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="http://localhost:8765"
            className="w-full text-sm px-2 py-1.5 rounded-md border border-border bg-input-background"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Where the lale FastAPI service is running.
          </p>
        </div>

        <div className="rounded-md border border-border p-3 bg-muted/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Anthropic key
          </div>
          <p className="text-xs">
            Set <code style={{ fontFamily: 'var(--font-mono)' }}>ANTHROPIC_API_KEY</code> in the
            backend environment. The extension never sees the key — translation happens
            server-side.
          </p>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border bg-card shrink-0 flex justify-end gap-2">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={() => setSettings({ backendUrl })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
