import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'lale — Lean verification for Overleaf',
  version: '0.0.1',
  description:
    'Verify mathematical claims in Overleaf papers using Lean 4 + Claude autoformalization.',
  action: { default_title: 'lale' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'sidePanel', 'scripting', 'activeTab'],
  host_permissions: ['https://www.overleaf.com/*', 'http://localhost:8765/*'],
  content_scripts: [
    {
      matches: ['https://www.overleaf.com/project/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/sidepanel/index.html'],
      matches: ['<all_urls>'],
    },
  ],
});
