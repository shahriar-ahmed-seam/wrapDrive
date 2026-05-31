import { useEffect, useRef, useState } from 'react';
import {
  API_NAMESPACE,
  negotiate,
  parsePrepareUploadResult,
  serializePrepareUploadRequest,
  type Capabilities,
  type DeviceInfo,
  type FileMeta,
  type PrepareUploadRequest,
} from '@wrapdrive/protocol';
import { sendParallel, sendSingleStream } from '@wrapdrive/transfer-engine';
import { BrowserFileAdapter, FetchSenderTransport, browserLocalFile } from './browser-transfer';
import {
  detectHostBridge,
  hasFileSystemAccess,
  webCapabilities,
  type WebMode,
} from './capabilities';

interface UiPeer {
  fingerprint: string;
  alias: string;
  address: string;
  port: number;
  capabilities: Capabilities;
  info: DeviceInfo;
}

/**
 * The WrapDrive web app. Detects whether a web-host bridge is present and
 * honestly reflects the transfer mode: full parity with the bridge, or
 * single-file send-only in a pure browser. Sending uses the shared engine via
 * a browser File adapter + fetch transport.
 */
export function App(): JSX.Element {
  const [mode, setMode] = useState<WebMode>('pure-browser');
  const [peers, setPeers] = useState<UiPeer[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedPeer = useRef<UiPeer | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const hasBridge = await detectHostBridge();
      if (!active) return;
      setMode(hasBridge ? 'host-bridge' : 'pure-browser');
      if (hasBridge) void pollPeers(setPeers);
    })();
    return () => {
      active = false;
    };
  }, []);

  const myCaps = webCapabilities(mode);

  function pickFor(peer: UiPeer): void {
    selectedPeer.current = peer;
    fileInput.current?.click();
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    const peer = selectedPeer.current;
    if (!file || !peer) return;
    await sendFile(peer, file, myCaps, setProgress, setStatusText);
    e.target.value = '';
  }

  return (
    <div className="app">
      <div className="brand">WrapDrive</div>
      <div className="subtle">Local-network file sharing, in your browser.</div>

      <ModeBanner mode={mode} fsa={hasFileSystemAccess()} />

      {progress !== null ? (
        <div>
          <div className="ring" style={{ ['--pct' as string]: Math.round(progress * 100) }}>
            <div className="inner">{Math.round(progress * 100)}%</div>
          </div>
          <div className="subtle" style={{ textAlign: 'center' }}>
            {statusText}
          </div>
        </div>
      ) : peers.length === 0 ? (
        <div className="empty">
          <div className="radar" />
          {mode === 'host-bridge'
            ? 'Searching for devices on your network…'
            : 'Run the WrapDrive web-host companion to discover and receive from devices.'}
        </div>
      ) : (
        <div className="peer-list">
          {peers.map((peer) => (
            <div className="peer-card" key={peer.fingerprint} onClick={() => pickFor(peer)}>
              <div className="peer-avatar">{peer.alias.charAt(0).toUpperCase()}</div>
              <div>
                <div className="alias">{peer.alias}</div>
                <div className="addr">{peer.address} · tap to send</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => void onFilesChosen(e)}
      />
    </div>
  );
}

function ModeBanner({ mode, fsa }: { mode: WebMode; fsa: boolean }): JSX.Element {
  if (mode === 'host-bridge') {
    return (
      <div className="mode-banner">
        Connected to the web-host companion — full parallel chunked send and receive.
      </div>
    );
  }
  return (
    <div className="mode-banner single-file">
      Single-file mode. A browser tab can send files (in parallel when the receiver supports it) but
      cannot receive chunked transfers{fsa ? '' : ' and lacks the File System Access API'}. Install
      the web-host companion for full two-way parity.
    </div>
  );
}

async function pollPeers(setPeers: (peers: UiPeer[]) => void): Promise<void> {
  // The host bridge exposes the live peer list at a small JSON endpoint.
  try {
    const res = await fetch('http://127.0.0.1:53317/api/wrapdrive/v1/peers');
    if (res.ok) {
      const data = (await res.json()) as UiPeer[];
      setPeers(data);
    }
  } catch {
    // bridge not ready yet
  }
  setTimeout(() => void pollPeers(setPeers), 2000);
}

async function sendFile(
  peer: UiPeer,
  file: File,
  myCaps: Capabilities,
  setProgress: (p: number | null) => void,
  setStatus: (s: string) => void,
): Promise<void> {
  setProgress(0);
  setStatus(`Preparing ${file.name}…`);

  const adapter = new BrowserFileAdapter(file);
  const sha256 = await adapter.sha256();
  const meta: FileMeta = {
    id: 'file-1',
    fileName: file.name,
    size: file.size,
    fileType: file.type || 'application/octet-stream',
    sha256,
    preview: null,
  };

  const baseUrl = `http://${peer.address}:${peer.port}`;
  const plan = negotiate(myCaps, peer.capabilities, file.size);
  const request: PrepareUploadRequest = {
    info: { ...peer.info, alias: 'Web browser' },
    capabilities: myCaps,
    files: { [meta.id]: meta },
    proposedPlan: plan,
  };

  const prepRes = await fetch(`${baseUrl}${API_NAMESPACE}/prepare-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: serializePrepareUploadRequest(request),
  });
  if (!prepRes.ok) {
    setStatus(`Rejected (${prepRes.status})`);
    setTimeout(() => setProgress(null), 2000);
    return;
  }
  const result = parsePrepareUploadResult(await prepRes.text());
  const token = result.files[meta.id];
  if (!token) return;

  const target = { sessionId: result.sessionId, fileId: meta.id, token };
  const transport = new FetchSenderTransport(baseUrl);
  const localFile = browserLocalFile(file);

  if (result.acceptedPlan.mode === 'parallel-chunked') {
    setStatus(`Sending in parallel…`);
    await sendParallel(target, localFile, result.acceptedPlan, adapter, transport, {
      onProgress: (completed, total) => setProgress(completed / total),
    });
  } else {
    setStatus(`Sending…`);
    await sendSingleStream(target, localFile, adapter, transport);
    setProgress(1);
  }
  setStatus(`Sent ${file.name}`);
  setTimeout(() => setProgress(null), 2000);
}
