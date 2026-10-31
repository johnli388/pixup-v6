'use client';
import { useI18n } from './i18n';
import Link from 'next/link';
import type { ItemPassport as Passport } from '../../../packages/domain/contracts';
import {} from './ui';

export function ItemPassport({ passport: p }: { passport: Passport }) {
  const { t: tr, date } = useI18n();

  return (
    <section className="panel" aria-label={tr('Item passport')}>
      <h2>{tr('Item passport')}</h2>
      <dl className="spec-list">
        <div>
          <dt>{tr('Source registration')}</dt>
          <dd>
            {tr('Registry record · ')}
            {date(p.registered_at)}
            <br />
            <small>{p.registration_scope}</small>
          </dd>
        </div>
        <div>
          <dt>{tr('Issuance source')}</dt>
          <dd>{p.issuance_mode || tr('Not established')}</dd>
        </div>
        <div>
          <dt>{tr('VIA authenticity')}</dt>
          <dd>
            {p.authenticity === 'unverified' ? tr('Not yet VIA assessed') : p.authenticity}
            <br />
            <small>
              {p.assessed_at
                ? `Assessment recorded ${date(p.assessed_at)}`
                : tr('No assessment recorded')}
            </small>
          </dd>
        </div>
        <div>
          <dt>{tr('Condition')}</dt>
          <dd>
            {p.condition_grade}
            {p.authenticity !== 'verified' && (
              <small>{tr(' · No current valid authenticity approval')}</small>
            )}
          </dd>
        </div>
        <div>
          <dt>{tr('Certificate')}</dt>
          <dd>
            {p.certificate ? (
              <Link href={`/verify/${p.certificate.id}`}>
                {p.certificate.status}
                {tr(' assessment record')}
              </Link>
            ) : (
              tr('No certificate issued')
            )}
          </dd>
        </div>
        <div>
          <dt>{tr('Physical custody')}</dt>
          <dd>
            {p.custody}
            <br />
            <small>
              {tr('Custody and title are separate. Scanning a record does not claim ownership.')}
            </small>
          </dd>
        </div>
      </dl>
      <p className="muted">
        {tr(
          'Demonstration records. Physical authentication, rights evidence and custody have not been independently verified.',
        )}
      </p>
    </section>
  );
}
