import { useEffect, useState } from 'react';
import type { UiConsent, UiPeer, UiTransfer } from '../electron/ipc-contract';

/**
 * The WrapDrive desktop renderer: a frameless, Discord/WhatsApp-style window
 * with a custom title bar, a sidebar, a peer grid, a live transfer view, and an
 * incoming-consent dialog. All privileged work happens in the main process via
 * the `window.wrapdrive` bridge.
 */
export function App(): JSX.Element {
  const [peers, setPeers] = useState<UiPeer[]>([]);
  const [transfer, setTransfer] = useState<UiTransfer | null>(null);
  const [consent, setConsent] = useState<UiConsent | null>(null);
  const [selfAlias, setSelfAlias] = useState('This Device');

  useEffect(() => {
    const offPeers = window.wrapdrive.onPeers(setPeers);
    const offTransfer = window.wrapdrive.onTransfer(setTransfer);
    const offConsent = window.wrapdrive.onConsent(setConsent);
    void window.wrapdrive.getSelfAlias().then(setSelfAlias);
    return () => {
      offPeers();
      offTransfer();
      offConsent();
    };
  }, []);

  async function sendTo(peer: UiPeer): Promise<void> {
    const paths = await window.wrapdrive.pickFiles();
    if (paths.length > 0) {
      await window.wrapdrive.sendFiles(peer.fingerprint, paths);
    }
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <aside className="sidebar">
          <h2>This device</h2>
          <div className="peer-meta">
            <div className="alias">{selfAlias}</div>
            <div className="addr">Ready to share</div>
          </div>
          <h2 style={{ marginTop: 'auto' }}>WrapDrive</h2>
          <div className="subtle">Local-network file sharing</div>
        </aside>

        <main className="main">
          {transfer ? (
            <TransferView transfer={transfer} />
          ) : (
            <DiscoveryView peers={peers} onSend={sendTo} />
          )}
        </main>
      </div>

      {consent && (
        <ConsentDialog
          consent={consent}
          onResult={(ok) => window.wrapdrive.resolveConsent(consent.id, ok)}
        />
      )}
    </div>
  );
}

function TitleBar(): JSX.Element {
  return (
    <div className="titlebar">
      <span className="brand">WrapDrive</span>
      <div className="window-controls">
        <button onClick={() => window.wrapdrive.windowAction('minimize')} aria-label="Minimize">
          &#x2013;
        </button>
        <button onClick={() => window.wrapdrive.windowAction('maximize')} aria-label="Maximize">
          &#x25A1;
        </button>
        <button
          className="close"
          onClick={() => window.wrapdrive.windowAction('close')}
          aria-label="Close"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

function DiscoveryView({
  peers,
  onSend,
}: {
  peers: UiPeer[];
  onSend: (peer: UiPeer) => void;
}): JSX.Element {
  return (
    <div>
      <div className="headline">Nearby devices</div>
      <div className="subtle">Pick a device, then choose files to send.</div>
      {peers.length === 0 ? (
        <div className="empty">
          <div className="radar" />
          <div>Searching for devices on your network…</div>
        </div>
      ) : (
        <div className="peer-grid">
          {peers.map((peer) => (
            <div className="peer-card" key={peer.fingerprint} onClick={() => onSend(peer)}>
              <div className="peer-avatar">{peer.alias.charAt(0).toUpperCase()}</div>
              <div className="peer-meta">
                <div className="alias">{peer.alias}</div>
                <div className="addr">{peer.address} · tap to send</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransferView({ transfer }: { transfer: UiTransfer }): JSX.Element {
  const pct = Math.round(transfer.fraction * 100);
  return (
    <div className="transfer">
      <div className="ring" style={{ ['--pct' as string]: pct }}>
        <div className="inner">{pct}%</div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 18 }}>{transfer.fileName}</div>
      <div className="subtle">
        {formatSpeed(transfer.bytesPerSecond)} · {transfer.state}
      </div>
    </div>
  );
}

function ConsentDialog({
  consent,
  onResult,
}: {
  consent: UiConsent;
  onResult: (accepted: boolean) => void;
}): JSX.Element {
  return (
    <div className="overlay">
      <div className="dialog">
        <h3>Incoming transfer</h3>
        <div className="files">
          {consent.fromAlias} wants to send:
          <br />
          {consent.fileSummary}
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => onResult(false)}>
            Decline
          </button>
          <button className="btn primary" onClick={() => onResult(true)}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '—';
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`;
}
