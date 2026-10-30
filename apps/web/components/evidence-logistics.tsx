'use client';
import { useEffect, useRef, useState } from 'react';
import { useAction, useData, useSession, type Row } from './providers';
import { ErrorNotice, Loading, Status, date } from './ui';

export function EvidenceWorkspace() {
  const { user, request } = useSession(),
    { data, error, refetch } = useData('/evidence');
  const [purpose, setPurpose] = useState('intake'),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(''),
    [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const permissions = user?.staff_permissions || [];
  async function upload(form: HTMLFormElement) {
    const d = new FormData(form),
      file = d.get('file') as File;
    if (!file?.size) return;
    setBusy(true);
    setProblem('');
    setMessage('Preparing private upload…');
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (file.size > 10485760) throw new Error('Choose a file no larger than 10 MB.');
      const buffer = await file.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (x) =>
        x.toString(16).padStart(2, '0'),
      ).join('');
      const target = String(d.get('scope') || '').trim();
      const scope =
        purpose === 'artwork'
          ? {}
          : purpose === 'rights'
            ? { collection_id: target }
            : { asset_id: target };
      const reservation = await request(
        '/evidence',
        {
          purpose,
          ...scope,
          mime: file.type,
          size: file.size,
          hash,
          client_key: `${purpose}-${target}-${hash}`,
        },
        undefined,
        abort.signal,
      );
      setMessage('Uploading privately…');
      const response = await fetch(`/api/evidence/${reservation.id}/bytes`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type, 'X-CSRF-Token': user?.csrf || '' },
        body: file,
        signal: abort.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Upload failed.');
      setMessage(
        `Upload ${reservation.id} saved. Malware scanning and independent review are required.`,
      );
      await refetch();
    } catch (e) {
      setProblem(
        (e as Error).name === 'AbortError'
          ? 'Upload canceled. Select the same file and scope to safely retry.'
          : (e as Error).message,
      );
      setMessage('');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <section className="panel spaced">
      <h2>Private evidence</h2>
      <p>
        Upload item photographs or rights documents. Files stay private; only approved artwork can
        appear publicly. Use fictional evidence in this local pilot.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void upload(e.currentTarget);
        }}
        className="form-grid"
      >
        <label className="field">
          Evidence purpose
          <select value={purpose} disabled={busy} onChange={(e) => setPurpose(e.target.value)}>
            <option value="intake">Intake photographs</option>
            <option value="rights">Collection rights document</option>
            <option value="shipment">Shipment evidence</option>
            <option value="incident">Loss, damage or identity evidence</option>
            <option value="artwork">Artwork for moderation</option>
          </select>
        </label>
        {purpose !== 'artwork' && (
          <label className="field">
            {purpose === 'rights' ? 'Collection ID' : 'Item ID'}
            <input name="scope" required maxLength={100} disabled={busy} />
          </label>
        )}
        <label className="field">
          Evidence file
          <input
            name="file"
            type="file"
            required
            accept={
              purpose === 'artwork'
                ? 'image/png,image/jpeg,image/webp'
                : 'image/png,image/jpeg,image/webp,application/pdf'
            }
            disabled={busy}
          />
        </label>
        <div className="button-row">
          <button className="button" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload private evidence'}
          </button>
          {busy && (
            <button
              type="button"
              className="button secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancel upload
            </button>
          )}
        </div>
      </form>
      <p role="status">{message}</p>
      <ErrorNotice error={problem || error} />
      <button className="button secondary small" onClick={() => void refetch()}>
        Refresh file status
      </button>
      {data?.files.map((f: Row) => (
        <details key={f.id} className="panel spaced">
          <summary>
            <Status status={f.state} /> {f.purpose} · <code>{f.id}</code>
          </summary>
          <p>
            {f.asset_id || f.collection_id || 'Private artwork'} · {f.mime} ·{' '}
            {Math.ceil(f.size / 1024)} KB
          </p>
          <p>
            Retention minimum: {date(f.retain_until)}
            {f.legal_hold ? ' · Legal hold' : ''}. Referenced evidence requires further retention
            review.
          </p>
          {f.error_code && (
            <p role="status">
              Processing unavailable: {f.error_code}. The file remains quarantined; the worker will
              retry.
            </p>
          )}
          {['pending_review', 'approved'].includes(f.state) && (
            <a className="text-link" href={`/api/evidence/${f.id}/download`}>
              Download private original
            </a>
          )}
          {f.purpose === 'artwork' && f.state === 'approved' && (
            <p>
              Approved artwork reference: <code>media:{f.id}</code>
            </p>
          )}
          {f.review_note && <p>Review: {f.review_note}</p>}
          {permissions.includes(
            f.purpose === 'rights' || f.purpose === 'artwork'
              ? 'rights'
              : f.purpose === 'incident'
                ? 'support'
                : 'warehouse',
          ) &&
            f.owner_id !== user?.id &&
            ['pending_review', 'approved'].includes(f.state) && (
              <EvidenceReview file={f} done={() => void refetch()} />
            )}
          {permissions.includes('audit') && !['purged', 'purging'].includes(f.state) && (
            <RetentionForm file={f} done={() => void refetch()} />
          )}
        </details>
      ))}
      {data?.files.length === 0 && <p>No uploaded evidence yet.</p>}
      <IncidentForm files={data?.files || []} />
    </section>
  );
}
function EvidenceReview({ file, done }: { file: Row; done: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        if (
          await a.run(
            `/ops/evidence/${file.id}/review`,
            { approve: d.get('decision') === 'approve', note: d.get('note') },
            'Review recorded',
          )
        )
          done();
      }}
    >
      <label className="field">
        Moderation decision
        <select name="decision">
          {file.state === 'pending_review' && (
            <option value="approve">Approve content for its stated purpose</option>
          )}
          <option value="reject">Reject or withdraw approval</option>
        </select>
      </label>
      <label className="field">
        Moderation reason
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Record content review
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function RetentionForm({ file, done }: { file: Row; done: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget),
          action = String(d.get('action'));
        if (
          await a.run(
            `/ops/evidence/${file.id}/${action === 'purge' ? 'purge' : 'hold'}`,
            { note: d.get('note'), ...(action === 'purge' ? {} : { hold: action === 'hold' }) },
            'Retention action recorded',
          )
        )
          done();
      }}
    >
      <label className="field">
        Retention action
        <select name="action">
          <option value="hold">Place legal hold</option>
          <option value="release">Release legal hold</option>
          <option value="purge">Purge expired, unreferenced bytes</option>
        </select>
      </label>
      <label className="field">
        Retention reason
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Apply retention action
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function EvidenceSelect({
  name,
  label,
  files,
  asset,
  purposes,
}: {
  name: string;
  label: string;
  files: Row[];
  asset: string;
  purposes: string[];
}) {
  return (
    <label className="field">
      {label}
      <select name={name} required defaultValue="">
        <option value="" disabled>
          Choose approved evidence
        </option>
        {files
          .filter(
            (f) => f.asset_id === asset && f.state === 'approved' && purposes.includes(f.purpose),
          )
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.purpose} · {f.id}
            </option>
          ))}
      </select>
    </label>
  );
}
function IncidentForm({ files }: { files: Row[] }) {
  const a = useAction();
  return (
    <details className="spaced">
      <summary>Report loss, damage or an identity mismatch</summary>
      <p>
        A report quarantines the item and opens a support review. It does not issue a refund or
        compensation.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget),
            file = files.find((f) => f.id === d.get('evidence_id'));
          if (!file) return;
          await a.run(
            '/incidents',
            {
              asset_id: file.asset_id,
              kind: d.get('kind'),
              evidence_id: file.id,
              note: d.get('note'),
              ...(d.get('order_id') ? { order_id: d.get('order_id') } : {}),
            },
            'Physical incident opened; item held for review',
          );
        }}
      >
        <label className="field">
          Incident type
          <select name="kind">
            <option value="damage">Damage</option>
            <option value="loss">Loss</option>
            <option value="identity_mismatch">Identity mismatch</option>
          </select>
        </label>
        <label className="field">
          Approved incident evidence
          <select name="evidence_id" required defaultValue="">
            <option value="" disabled>
              Choose evidence and item
            </option>
            {files
              .filter(
                (f) =>
                  f.asset_id &&
                  f.state === 'approved' &&
                  ['incident', 'intake', 'shipment'].includes(f.purpose),
              )
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.asset_id} · {f.id}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Related order ID (optional)
          <input name="order_id" />
        </label>
        <label className="field">
          Incident description
          <textarea name="note" required minLength={10} maxLength={2000} />
        </label>
        <button className="button secondary" disabled={a.busy}>
          Open physical incident
        </button>
        <ErrorNotice error={a.error} />
      </form>
    </details>
  );
}
export function LogisticsOperations() {
  const { data, error, refetch } = useData('/ops/logistics'),
    { data: files } = useData('/evidence'),
    { user } = useSession();
  const warehouse = user?.staff_permissions.includes('warehouse'),
    support = user?.staff_permissions.includes('support');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  return (
    <section>
      <h2>Physical handling and shipment tracking</h2>
      <p>
        Labels identify local records. Carrier events are simulated; these labels are not postage or
        proof of ownership.
      </p>
      <button className="button secondary" onClick={() => void refetch()}>
        Refresh physical status
      </button>
      {data.intakes.map((i: Row) => (
        <details className="panel spaced" key={i.id}>
          <summary>
            {i.title} · {i.status}
          </summary>
          <p>
            Item ID: <code>{i.asset_id}</code> · Registered serial: <code>{i.serial}</code>
          </p>
          {i.capture_id ? (
            <p>
              Intake label: <code>{i.label_code}</code> · Seal: {i.seal} · Bin: {i.bin}
            </p>
          ) : (
            warehouse && (
              <CaptureForm intake={i} files={files?.files || []} done={() => void refetch()} />
            )
          )}
        </details>
      ))}
      {warehouse &&
        data.orders.map((o: Row) => (
          <ShipmentCreate
            key={o.id}
            order={o}
            files={files?.files || []}
            done={() => void refetch()}
          />
        ))}
      {data.shipments.map((s: Row) => (
        <details key={s.id} className="panel spaced">
          <summary>
            {s.title} · <Status status={s.state} />
          </summary>
          <p>SIMULATED CARRIER · NOT POSTAGE</p>
          <p>
            Label: <code>{s.label_code}</code> · Item: <code>{s.asset_id}</code> · Seal:{' '}
            <code>{s.seal}</code>
          </p>
          <button className="button secondary small" onClick={() => window.print()}>
            Print local record
          </button>
          <ShipmentEvent shipment={s} files={files?.files || []} done={() => void refetch()} />
        </details>
      ))}
      <h3>Loss, damage and identity reviews</h3>
      {data.incidents.map((i: Row) => (
        <details className="panel spaced" key={i.id}>
          <summary>
            {i.title} · {i.kind} · {i.state}
          </summary>
          <p>{i.note}</p>
          {i.resolution && <p>{i.resolution}</p>}
          {support && i.state === 'open' && i.reporter_id !== user?.id && (
            <ResolveIncident incident={i} done={() => void refetch()} />
          )}
        </details>
      ))}
    </section>
  );
}
function CaptureForm({ intake, files, done }: { intake: Row; files: Row[]; done: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        if (
          await a.run(
            `/ops/intakes/${intake.id}/capture`,
            d,
            'Identity capture saved; receipt and independent VIA review remain required',
          )
        )
          done();
      }}
    >
      <label className="field">
        Observed serial
        <input name="observed_serial" required minLength={3} maxLength={100} />
      </label>
      <label className="field">
        Tamper seal
        <input name="seal" required minLength={3} maxLength={100} />
      </label>
      <label className="field">
        Storage bin
        <input name="bin" required minLength={3} maxLength={100} />
      </label>
      <EvidenceSelect
        name="front_file"
        label="Front photograph"
        files={files.filter((f) => f.mime.startsWith('image/'))}
        asset={intake.asset_id}
        purposes={['intake']}
      />
      <EvidenceSelect
        name="back_file"
        label="Back photograph"
        files={files.filter((f) => f.mime.startsWith('image/'))}
        asset={intake.asset_id}
        purposes={['intake']}
      />
      <label className="field">
        Capture note
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button" disabled={a.busy}>
        Bind physical identity
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function ShipmentCreate({ order, files, done }: { order: Row; files: Row[]; done: () => void }) {
  const a = useAction();
  return (
    <details className="panel spaced">
      <summary>Prepare shipment: {order.title}</summary>
      <p>
        Item ID: <code>{order.asset_id}</code>
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await a.run(
              `/ops/orders/${order.id}/shipment`,
              Object.fromEntries(new FormData(e.currentTarget)),
              'Simulated label created; item remains in vault custody',
            )
          )
            done();
        }}
      >
        <label className="field">
          Package seal
          <input name="seal" required minLength={3} maxLength={100} />
        </label>
        <EvidenceSelect
          name="evidence_id"
          label="Packing evidence"
          files={files}
          asset={order.asset_id}
          purposes={['shipment']}
        />
        <button className="button secondary" disabled={a.busy}>
          Create simulated label
        </button>
        <ErrorNotice error={a.error} />
      </form>
    </details>
  );
}
function ShipmentEvent({
  shipment: s,
  files,
  done,
}: {
  shipment: Row;
  files: Row[];
  done: () => void;
}) {
  const a = useAction();
  const kinds =
    s.state === 'label_created'
      ? ['dispatched', 'loss', 'damage']
      : s.state === 'in_transit'
        ? ['delivered', 'loss', 'damage', 'returned']
        : s.state === 'exception'
          ? ['returned']
          : s.state === 'delivered'
            ? ['returned', 'loss', 'damage']
            : [];
  if (!kinds.length) return null;
  return (
    <form
      key={s.sequence}
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await a.run(
            `/ops/shipments/${s.id}/events`,
            {
              ...Object.fromEntries(new FormData(e.currentTarget)),
              client_key: crypto.randomUUID(),
              expected_sequence: s.sequence,
            },
            'Simulated tracking event recorded',
          )
        )
          done();
      }}
    >
      <label className="field">
        Simulated carrier event
        <select name="kind">
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Confirm package seal
        <input name="seal" required minLength={3} />
      </label>
      <EvidenceSelect
        name="evidence_id"
        label="Event evidence"
        files={files}
        asset={s.asset_id}
        purposes={['shipment', 'incident']}
      />
      <label className="field">
        Handoff or exception note
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Record simulated event
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
function ResolveIncident({ incident, done }: { incident: Row; done: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await a.run(
            `/ops/incidents/${incident.id}/resolve`,
            { expected_version: incident.version, note: new FormData(e.currentTarget).get('note') },
            'Review resolved; quarantine remains pending physical return and reassessment',
          )
        )
          done();
      }}
    >
      <p>
        Resolution retains quarantine and revoked certification. Refunds and reassessment use their
        separate workflows.
      </p>
      <label className="field">
        Independent resolution
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button className="button secondary" disabled={a.busy}>
        Resolve incident review
      </button>
      <ErrorNotice error={a.error} />
    </form>
  );
}
export function ShipmentTimeline({ orderId }: { orderId: string }) {
  const { data, error, refetch } = useData(`/orders/${orderId}/shipment`);
  if (error) return <ErrorNotice error={error} />;
  if (!data?.shipment) return null;
  return (
    <section className="panel spaced">
      <h3>Simulated carrier tracking</h3>
      <p>
        <Status status={data.shipment.state} /> · {data.shipment.label_code}
      </p>
      <ol>
        {data.events.map((e: Row) => (
          <li key={e.sequence}>
            {e.kind} · {date(e.created_at)}
          </li>
        ))}
      </ol>
      <button className="button secondary small" onClick={() => void refetch()}>
        Refresh tracking
      </button>
    </section>
  );
}
