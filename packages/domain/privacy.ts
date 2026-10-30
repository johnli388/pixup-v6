import { one, type SQL } from '../database/index';
import { check } from './core';
export function privacyPolicy() {
  const minimum_age = Number(process.env.PILOT_MINIMUM_AGE || 18);
  check(
    Number.isInteger(minimum_age) && minimum_age >= 18 && minimum_age <= 99,
    'INVALID_AGE_POLICY',
    'PILOT_MINIMUM_AGE must be an integer from 18 to 99.',
    500,
  );
  return {
    minimum_age,
    terms_version: 'pilot-terms-v1',
    privacy_version: 'pilot-privacy-v1',
    notice:
      'Local pilot: account, order, custody and security records support transactions and recovery. Financial and audit history may need retention. Optional marketing defaults off. Age declaration is self-attestation, not identity verification.',
  };
}
export async function requireEligibility(tx: SQL, userId: string) {
  const p = privacyPolicy(),
    row = await one(
      tx,
      'SELECT p.*,u.closed_at FROM users u LEFT JOIN privacy_profiles p ON p.user_id=u.id WHERE u.id=$1',
      [userId],
    );
  check(
    row && !row.closed_at && !row.restriction,
    'ACCOUNT_RESTRICTED',
    'New commercial activity is restricted. Visit account privacy settings or contact support.',
    403,
  );
  check(
    row.age_attested_at &&
      row.minimum_age >= p.minimum_age &&
      row.terms_version === p.terms_version &&
      row.privacy_version === p.privacy_version,
    'CONSENT_REQUIRED',
    'Review the current pilot terms, privacy notice and age declaration in account settings.',
    403,
  );
}
