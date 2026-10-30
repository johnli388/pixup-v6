import { randomBytes } from 'node:crypto';
import type { Database } from '../../../packages/database/index';
import { one } from '../../../packages/database/index';
import { hash, passwordHash, passwordMatches } from '../../../packages/domain/security';
import { check, id } from '../../../packages/domain/core';
import type { Organization, StaffPermission } from '../../../packages/domain/contracts';
export type Actor = {
  id: string;
  email: string;
  name: string;
  is_staff: boolean;
  csrf: string;
  organizations: Organization[];
  staff_permissions: StaffPermission[];
};

export class AuthService {
  constructor(private db: Database) {}
  async session(token?: string): Promise<Actor | null> {
    if (!token) return null;
    const user = await one(
      this.db,
      `SELECT u.id,u.email,u.name,u.is_staff,s.csrf_token AS csrf FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()`,
      [hash(token)],
    );
    if (!user) return null;
    user.staff_permissions = user.is_staff
      ? (
          await this.db.query(
            'SELECT permission FROM staff_permissions WHERE user_id=$1 ORDER BY permission',
            [user.id],
          )
        ).rows.map((p) => p.permission)
      : [];
    user.organizations = (
      await this.db.query(
        'SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 ORDER BY o.id',
        [user.id],
      )
    ).rows;
    return user as Actor;
  }
  async login(email: string, password: string) {
    const user = await one(this.db, 'SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    // Run scrypt for unknown accounts too, limiting simple timing disclosure.
    const valid = await passwordMatches(
      password,
      user?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64),
    );
    check(user && valid, 'INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    return this.createSession(user.id);
  }
  async register(name: string, email: string, password: string) {
    const encoded = await passwordHash(password);
    const uid = id();
    await this.db.transaction(async (tx) => {
      check(
        !(await one(tx, 'SELECT id FROM users WHERE email=$1', [email.toLowerCase()])),
        'EMAIL_IN_USE',
        'An account with this email already exists.',
        409,
      );
      await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,$3,$4)', [
        uid,
        email.toLowerCase(),
        name,
        encoded,
      ]);
      await tx.query("INSERT INTO organizations(id,name,kind) VALUES ($1,$2,'personal')", [
        `${uid}-org`,
        `${name}'s collection`,
      ]);
      await tx.query("INSERT INTO memberships(user_id,org_id,role) VALUES ($1,$2,'owner')", [
        uid,
        `${uid}-org`,
      ]);
    });
    return this.createSession(uid);
  }
  private async createSession(uid: string) {
    const token = randomBytes(32).toString('hex');
    await this.db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,now()+interval '7 days')",
      [hash(token), uid, randomBytes(24).toString('hex')],
    );
    return { token, user: await this.session(token) };
  }
  async logout(token: string) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
  }
}
export function requireUser(actor: Actor | null | undefined): Actor {
  check(actor, 'AUTH_REQUIRED', 'Please sign in to continue.', 401);
  return actor;
}
export function requireStaff(actor: Actor, permission?: StaffPermission) {
  check(actor.is_staff, 'FORBIDDEN', 'This action requires an operations account.', 403);
  if (permission)
    check(
      actor.staff_permissions.includes(permission),
      'FORBIDDEN',
      `This action requires ${permission} permission.`,
      403,
    );
}
