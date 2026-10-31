import Link from 'next/link';
import { Badge, PageTitle } from './ui';
import { pilotChannels } from './channel-samples';

export function PilotChannelDirectory() {
  return (
    <section aria-labelledby="pilot-preview-title">
      <h2 id="pilot-preview-title">California pilot previews</h2>
      <p className="muted">
        Three fictional pilot concepts across Los Angeles and the San Francisco Bay Area. Venues and
        opening dates are not confirmed; purchases are unavailable in these previews.
      </p>
      <div className="channel-grid">
        {pilotChannels.map((channel) => (
          <Link className="panel channel-card" href={`/channels/${channel.id}`} key={channel.id}>
            <span className="eyebrow">
              {channel.kind.toUpperCase()} · {channel.region}
            </span>
            <h3>{channel.name}</h3>
            <Badge>Pilot preview</Badge>
            <p>
              <strong>{channel.area}</strong>
            </p>
            <p>{channel.description}</p>
            <p className="muted">{channel.focus.join(' · ')}</p>
            <span className="text-link">Explore pilot →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function PilotChannelDetail({ channel }: { channel: (typeof pilotChannels)[number] }) {
  return (
    <>
      <Link className="text-link" href="/channels">
        ← All channels
      </Link>
      <PageTitle
        eyebrow={`${channel.kind.toUpperCase()} · ${channel.region}`}
        title={channel.name}
        description={channel.description}
      >
        <Badge>Pilot preview</Badge>
      </PageTitle>
      <div className="notice subtle">
        <div>
          <strong>Fictional pilot location</strong>
          <p>
            This is sample content. A venue, opening date and operating partner have not been
            confirmed.
          </p>
        </div>
      </div>
      <div className="channel-grid">
        <section className="panel">
          <h2>Pilot at a glance</h2>
          <dl className="spec-list">
            <div>
              <dt>Area</dt>
              <dd>{channel.area}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{channel.format}</dd>
            </div>
            <div>
              <dt>Collectibles</dt>
              <dd>{channel.focus.join(', ')}</dd>
            </div>
            <div>
              <dt>Opening</dt>
              <dd>To be announced</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>Preview only</dd>
            </div>
          </dl>
        </section>
        <section className="panel channel-terms">
          <h2>The pilot experience</h2>
          <ol>
            {channel.experience.map((step) => (
              <li key={step}>
                <p>{step}</p>
              </li>
            ))}
          </ol>
          <p className="muted">
            Checkout becomes available only for an activated channel with allocated inventory.
          </p>
          <Link className="button secondary" href="/marketplace">
            Explore the marketplace
          </Link>
        </section>
      </div>
    </>
  );
}
