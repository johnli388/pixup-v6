'use client';
import Link from 'next/link';
import type { ItemPassport as Passport } from '../../../packages/domain/contracts';
import { date } from './ui';

export function ItemPassport({ passport: p }: { passport: Passport }) {
  return (
    <section className="panel" aria-label="Item passport">
      <h2>Item passport</h2>
      <dl className="spec-list">
        <div>
          <dt>Source registration</dt>
          <dd>
            Registry record · {date(p.registered_at)}
            <br />
            <small>{p.registration_scope}</small>
          </dd>
        </div>
        <div>
          <dt>Issuance source</dt>
          <dd>{p.issuance_mode || 'Not established'}</dd>
        </div>
        <div>
          <dt>VIA authenticity</dt>
          <dd>
            {p.authenticity === 'unverified' ? 'Not yet VIA assessed' : p.authenticity}
            <br />
            <small>
              {p.assessed_at
                ? `Assessment recorded ${date(p.assessed_at)}`
                : 'No assessment recorded'}
            </small>
          </dd>
        </div>
        <div>
          <dt>Condition</dt>
          <dd>
            {p.condition_grade}
            {p.authenticity !== 'verified' && (
              <small> · No current valid authenticity approval</small>
            )}
          </dd>
        </div>
        <div>
          <dt>Certificate</dt>
          <dd>
            {p.certificate ? (
              <Link href={`/verify/${p.certificate.id}`}>
                {p.certificate.status} assessment record
              </Link>
            ) : (
              'No certificate issued'
            )}
          </dd>
        </div>
        <div>
          <dt>Physical custody</dt>
          <dd>
            {p.custody}
            <br />
            <small>
              Custody and title are separate. Scanning a record does not claim ownership.
            </small>
          </dd>
        </div>
      </dl>
      <p className="muted">
        Demonstration records. Physical authentication, rights evidence and custody have not been
        independently verified.
      </p>
    </section>
  );
}
