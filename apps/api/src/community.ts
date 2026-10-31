import { z } from 'zod';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { withDatabaseActor } from '../../../packages/database/context';
import { audit, check, id } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import { privacyPolicy } from '../../../packages/domain/privacy';
import { publicAssetSql } from '../../../packages/domain/catalog-visibility';
import * as c from '../../../packages/domain/community';
import { requireStaff, type Actor } from './auth';

type Row = Record<string, any>;
const version = (row: Row, expected: number) =>
  check(
    row.version === expected,
    'COMMUNITY_STALE',
    'This content changed. Reload before trying again.',
  );
const found = (row: Row | undefined): Row => {
  check(row, 'NOT_FOUND', 'Community content not found.', 404);
  return row;
};
export class CommunityService {
  constructor(
    private db: Database,
    private options: c.CommunityOptions = {},
  ) {}
  config() {
    const enabled = this.options.enabled ?? process.env.COMMUNITY_ENABLED === 'true';
    return {
      enabled,
      writes: enabled && (this.options.writes ?? process.env.COMMUNITY_WRITES_ENABLED === 'true'),
      minimum_age: privacyPolicy().minimum_age,
      guidelines_version: c.communityGuidelinesVersion,
      guidelines: c.communityGuidelines,
      audience: 'members',
      images: false,
      review: 'all_submissions',
    };
  }
  private run<T>(actor: Actor, fn: (tx: SQL) => Promise<T>) {
    return withDatabaseActor(actor.id, () =>
      this.db.transaction(async (tx) => {
        check(
          await one(tx, 'SELECT id FROM users WHERE id=$1 AND closed_at IS NULL', [actor.id]),
          'AUTH_REQUIRED',
          'Sign in to continue.',
          401,
        );
        return fn(tx);
      }),
    );
  }
  private reading() {
    check(this.config().enabled, 'COMMUNITY_DISABLED', 'Community Hub is not open yet.', 503);
  }
  private async eligible(tx: SQL, uid: string, gates = true) {
    if (gates)
      check(
        this.config().writes,
        'COMMUNITY_PAUSED',
        'Community contributions are paused. Reporting and recovery remain available.',
        409,
      );
    const u = await one(tx, 'SELECT id FROM users WHERE id=$1 AND closed_at IS NULL FOR UPDATE', [
      uid,
    ]);
    const p = await one(tx, 'SELECT * FROM privacy_profiles WHERE user_id=$1', [uid]);
    check(
      u && !p?.restriction,
      'ACCOUNT_RESTRICTED',
      'Account contributions are restricted. Visit account privacy settings.',
      403,
    );
    check(
      p?.age_attested_at && p.minimum_age >= privacyPolicy().minimum_age,
      'COMMUNITY_AGE_REQUIRED',
      'Complete the adult declaration in account settings first.',
      403,
    );
    check(
      await one(tx, 'SELECT 1 FROM community_profiles WHERE user_id=$1', [uid]),
      'COMMUNITY_PROFILE_REQUIRED',
      'Choose your community display name first.',
      403,
    );
    check(
      await one(tx, 'SELECT 1 FROM community_acceptances WHERE user_id=$1 AND version=$2', [
        uid,
        c.communityGuidelinesVersion,
      ]),
      'COMMUNITY_GUIDELINES_REQUIRED',
      'Accept the current community guidelines first.',
      403,
    );
    check(
      !(await one(tx, 'SELECT 1 FROM community_sanctions WHERE user_id=$1 AND until_at>now()', [
        uid,
      ])),
      'COMMUNITY_RESTRICTED',
      'Posting is temporarily restricted. You may still report, appeal or delete your content.',
      403,
    );
  }
  private async quota(tx: SQL, uid: string, bucket = 'write', limit = 60) {
    const row = (await one(
      tx,
      `INSERT INTO community_quotas(user_id,bucket) VALUES($1,$2) ON CONFLICT(user_id,bucket) DO UPDATE SET count=CASE WHEN community_quotas.started_at<now()-interval '1 hour' THEN 1 ELSE community_quotas.count+1 END,started_at=CASE WHEN community_quotas.started_at<now()-interval '1 hour' THEN now() ELSE community_quotas.started_at END RETURNING count`,
      [uid, bucket],
    ))!;
    check(
      row.count <= limit,
      'COMMUNITY_RATE_LIMIT',
      'Too many community requests. Try again in an hour.',
      429,
    );
  }
  private async authority(tx: SQL, actor: Actor) {
    requireStaff(actor, 'community_moderation');
    check(
      actor.mfa_verified_at && Date.parse(actor.mfa_verified_at) > Date.now() - 12 * 3600000,
      'MFA_REQUIRED',
      'Verify your authenticator before moderating.',
      403,
    );
    check(
      await one(
        tx,
        `SELECT u.id FROM users u JOIN staff_permissions p ON p.user_id=u.id JOIN authenticators a ON a.user_id=u.id WHERE u.id=$1 AND u.closed_at IS NULL AND u.is_staff AND p.permission='community_moderation' AND a.enabled_at IS NOT NULL FOR SHARE OF u,p,a`,
        [actor.id],
      ),
      'FORBIDDEN',
      'Current community moderation authority is required.',
      403,
    );
  }
  private async replay(tx: SQL, uid: string, op: string, key: string, data: unknown) {
    z.string().min(8).max(128).parse(key);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,15))', [
      `community:${uid}:${op}:${key}`,
    ]);
    const r = await one(
      tx,
      'SELECT * FROM community_requests WHERE user_id=$1 AND operation=$2 AND key=$3',
      [uid, op, key],
    );
    if (r)
      check(
        r.hash === hash(JSON.stringify(data)),
        'IDEMPOTENCY_CONFLICT',
        'This request key was used for different content.',
      );
    return r;
  }
  private async remember(
    tx: SQL,
    uid: string,
    op: string,
    key: string,
    data: unknown,
    eid: string,
  ) {
    await tx.query(
      'INSERT INTO community_requests(user_id,operation,key,hash,result_id) VALUES($1,$2,$3,$4,$5)',
      [uid, op, key, hash(JSON.stringify(data)), eid],
    );
  }
  private async references(tx: SQL, eid: string, topics: string[], assets: string[]) {
    check(
      new Set(topics).size === topics.length && new Set(assets).size === assets.length,
      'COMMUNITY_DUPLICATE_REFERENCE',
      'Choose distinct topics and cards.',
      400,
    );
    for (const topic of [...topics].sort())
      await tx.query('SELECT community_lock_topic($1)', [topic]);
    for (const topic of topics)
      check(
        await one(tx, 'SELECT id FROM community_topics WHERE id=$1 AND active', [topic]),
        'COMMUNITY_TOPIC',
        'Choose an active topic.',
        400,
      );
    for (const aid of assets)
      check(
        await one(tx, `SELECT a.id FROM assets a WHERE a.id=$1 AND ${publicAssetSql}`, [aid]),
        'COMMUNITY_CARD',
        'Only publicly available cards can be linked.',
        400,
      );
    await tx.query('DELETE FROM community_entry_topics WHERE entry_id=$1', [eid]);
    await tx.query('DELETE FROM community_links WHERE entry_id=$1', [eid]);
    for (const topic of topics)
      await tx.query('INSERT INTO community_entry_topics VALUES($1,$2)', [eid, topic]);
    for (const aid of assets)
      await tx.query('INSERT INTO community_links VALUES($1,$2)', [eid, aid]);
  }
  private async snapshot(tx: SQL, e: Row) {
    await tx.query(
      'INSERT INTO community_revisions(entry_id,version,author_id,title,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [e.id, e.version, e.author_id, e.title, e.body],
    );
  }
  private async event(tx: SQL, entry: Row, kind: 'reply' | 'moderation', eventId = id()) {
    await tx.query('INSERT INTO outbox(id,type,aggregate_id,payload) VALUES($1,$2,$3,$4)', [
      eventId,
      'community_notification',
      entry.id,
      JSON.stringify({ entry_id: entry.id, kind }),
    ]);
  }
  private async project(tx: SQL, e: Row, uid: string) {
    const deleted = e.state === 'deleted';
    const profile = deleted
      ? null
      : await one(tx, 'SELECT public_id,display_name FROM community_profiles WHERE user_id=$1', [
          e.author_id,
        ]);
    const topics = (
      await tx.query(
        'SELECT t.id,t.name,t.active FROM community_topics t JOIN community_entry_topics x ON x.topic_id=t.id WHERE x.entry_id=$1 ORDER BY t.id',
        [e.id],
      )
    ).rows;
    const links = (
      await tx.query(
        `SELECT CASE WHEN ${publicAssetSql} THEN a.id ELSE NULL END AS id,CASE WHEN ${publicAssetSql} THEN a.title ELSE 'Linked item unavailable' END AS title FROM community_links l LEFT JOIN assets a ON a.id=l.asset_id WHERE l.entry_id=$1`,
        [e.id],
      )
    ).rows;
    const likes = await one(tx, 'SELECT community_like_count($1) AS n', [e.id]);
    const relations = (
      await tx.query('SELECT kind FROM community_relations WHERE user_id=$1 AND entry_id=$2', [
        uid,
        e.id,
      ])
    ).rows.map((r) => r.kind);
    return {
      id: e.id,
      post_id: e.post_id,
      parent_id: e.parent_id,
      type: e.type,
      title: deleted ? 'Post deleted' : e.title,
      body: deleted ? '' : e.body,
      state: e.state,
      moderation: e.moderation,
      version: e.version,
      locked: e.locked,
      created_at: e.created_at,
      updated_at: e.updated_at,
      author: profile,
      own: e.author_id === uid,
      topics,
      links,
      likes: likes?.n || 0,
      liked: relations.includes('like'),
      saved: relations.includes('save'),
    };
  }
  async me(actor: Actor) {
    return this.run(actor, async (tx) => ({
      config: this.config(),
      profile:
        (await one(
          tx,
          'SELECT public_id,display_name,bio,reply_notifications FROM community_profiles WHERE user_id=$1',
          [actor.id],
        )) || null,
      accepted: !!(await one(
        tx,
        'SELECT 1 FROM community_acceptances WHERE user_id=$1 AND version=$2',
        [actor.id, c.communityGuidelinesVersion],
      )),
      sanction:
        (await one(
          tx,
          'SELECT until_at,action_id FROM community_sanctions WHERE user_id=$1 AND until_at>now()',
          [actor.id],
        )) || null,
      relations: (
        await tx.query(
          "SELECT kind,target FROM community_relations WHERE user_id=$1 AND kind IN ('follow','mute_topic','mute_user')",
          [actor.id],
        )
      ).rows,
    }));
  }
  async profile(actor: Actor, input: unknown) {
    const d = c.communityProfileInput.parse(input);
    return this.run(actor, async (tx) => {
      this.reading();
      await this.quota(tx, actor.id);
      await tx.query(
        'INSERT INTO community_profiles(user_id,public_id,display_name,bio,reply_notifications) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET display_name=$3,bio=$4,reply_notifications=$5',
        [actor.id, id(), d.display_name, d.bio, d.reply_notifications],
      );
      return { ok: true };
    });
  }
  async accept(actor: Actor, input: unknown) {
    c.communityAcceptInput.parse(input);
    return this.run(actor, async (tx) => {
      await tx.query(
        'INSERT INTO community_acceptances(user_id,version) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [actor.id, c.communityGuidelinesVersion],
      );
      return { ok: true };
    });
  }
  async topics(actor: Actor) {
    return this.run(actor, async (tx) => {
      this.reading();
      return (
        await tx.query('SELECT id,name,description,active FROM community_topics ORDER BY name')
      ).rows;
    });
  }
  async suggestion(actor: Actor, input: unknown) {
    const d = c.communitySuggestionInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.eligible(tx, actor.id);
      await this.quota(tx, actor.id, 'suggestion', 5);
      await tx.query(
        'INSERT INTO community_suggestions(id,user_id,name,description) VALUES($1,$2,$3,$4)',
        [id(), actor.id, d.name, d.description],
      );
      return { ok: true };
    });
  }
  async member(actor: Actor, pid: string) {
    return this.run(actor, async (tx) => {
      this.reading();
      return found(
        await one(
          tx,
          'SELECT p.public_id,p.display_name,p.bio FROM community_profiles p JOIN users u ON u.id=p.user_id WHERE p.public_id=$1 AND u.closed_at IS NULL',
          [pid],
        ),
      );
    });
  }
  async feed(actor: Actor, input: unknown) {
    const d = c.communityFeedInput.parse(input);
    return this.run(actor, async (tx) => {
      if (d.feed !== 'mine') this.reading();
      const filterHash = hash(JSON.stringify({ ...d, cursor: undefined }));
      let cursor: { at: string; id: string; filter: string } | undefined;
      if (d.cursor) {
        try {
          cursor = z
            .object({ at: z.iso.datetime(), id: z.string().max(100), filter: z.string() })
            .parse(JSON.parse(Buffer.from(d.cursor, 'base64url').toString()));
        } catch {
          check(false, 'COMMUNITY_CURSOR', 'Invalid page cursor.', 400);
        }
        check(
          cursor!.filter === filterHash,
          'COMMUNITY_CURSOR',
          'Restart pagination after changing filters.',
          400,
        );
      }
      const params: unknown[] = [actor.id];
      const add = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      const where = ['e.post_id IS NULL'];
      if (d.feed === 'mine') where.push('e.author_id=$1');
      else where.push('community_visible(e.id)');
      if (d.feed === 'saved')
        where.push(
          "EXISTS(SELECT 1 FROM community_relations r WHERE r.user_id=$1 AND r.kind='save' AND r.entry_id=e.id)",
        );
      if (d.feed === 'following')
        where.push(
          "EXISTS(SELECT 1 FROM community_entry_topics t JOIN community_relations r ON r.topic_id=t.topic_id WHERE t.entry_id=e.id AND r.user_id=$1 AND r.kind='follow')",
        );
      if (d.feed !== 'mine')
        where.push(
          "NOT EXISTS(SELECT 1 FROM community_relations r WHERE r.user_id=$1 AND ((r.kind='mute_user' AND r.profile_id=p.public_id) OR (r.kind='mute_topic' AND EXISTS(SELECT 1 FROM community_entry_topics mt WHERE mt.entry_id=e.id AND mt.topic_id=r.topic_id))))",
        );
      if (d.topic)
        where.push(
          `EXISTS(SELECT 1 FROM community_entry_topics t WHERE t.entry_id=e.id AND t.topic_id=${add(d.topic)})`,
        );
      if (d.type) where.push(`e.type=${add(d.type)}`);
      if (d.profile) where.push(`p.public_id=${add(d.profile)}`);
      if (d.q)
        where.push(
          `to_tsvector('simple',e.title || ' ' || e.body) @@ plainto_tsquery('simple',${add(d.q)})`,
        );
      if (cursor)
        where.push(
          `(COALESCE(e.published_at,e.created_at),e.id)<(${add(cursor.at)}::timestamptz,${add(cursor.id)})`,
        );
      const rows = (
        await tx.query(
          `SELECT e.*,COALESCE(e.published_at,e.created_at) AS feed_at FROM community_entries e JOIN community_profiles p ON p.user_id=e.author_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(e.published_at,e.created_at) DESC,e.id DESC LIMIT ${add(d.limit + 1)}`,
          params,
        )
      ).rows;
      const more = rows.length > d.limit;
      const page = rows.slice(0, d.limit),
        last = page.at(-1);
      return {
        items: await Promise.all(page.map((e) => this.project(tx, e, actor.id))),
        next_cursor:
          more && last
            ? Buffer.from(
                JSON.stringify({
                  at: new Date(last.feed_at).toISOString(),
                  id: last.id,
                  filter: filterHash,
                }),
              ).toString('base64url')
            : null,
      };
    });
  }
  async detail(actor: Actor, eid: string) {
    return this.run(actor, async (tx) => {
      const e = found(
        await one(
          tx,
          'SELECT e.* FROM community_entries e WHERE e.id=$1 AND e.post_id IS NULL AND (e.author_id=$2 OR community_visible(e.id))',
          [eid, actor.id],
        ),
      );
      if (e.author_id !== actor.id) this.reading();
      return this.project(tx, e, actor.id);
    });
  }
  async comments(actor: Actor, pid: string, cursorInput: unknown = '') {
    const encoded = z.string().max(2000).parse(cursorInput);
    let cursor: { at: string; id: string; post: string } | null = null;
    if (encoded) {
      try {
        cursor = z
          .object({ at: z.iso.datetime(), id: z.string().max(100), post: z.string().max(100) })
          .parse(JSON.parse(Buffer.from(encoded, 'base64url').toString()));
      } catch {
        check(false, 'COMMUNITY_CURSOR', 'Invalid comment cursor.', 400);
      }
      check(
        cursor!.post === pid,
        'COMMUNITY_CURSOR',
        'This cursor belongs to another thread.',
        400,
      );
    }
    return this.run(actor, async (tx) => {
      this.reading();
      const p = found(
        await one(
          tx,
          'SELECT id FROM community_entries WHERE id=$1 AND post_id IS NULL AND community_visible(id)',
          [pid],
        ),
      );
      const rows = (
        await tx.query(
          `SELECT e.* FROM community_entries e WHERE e.post_id=$1 AND (community_visible(e.id) OR e.author_id=$2 OR (e.state='deleted' AND e.moderation NOT IN ('hidden','removed') AND e.parent_id IS NULL)) AND ($3::timestamptz IS NULL OR (e.created_at,e.id)>($3::timestamptz,$4)) ORDER BY e.created_at,e.id LIMIT 51`,
          [p.id, actor.id, cursor?.at || null, cursor?.id || ''],
        )
      ).rows;
      return {
        items: await Promise.all(rows.slice(0, 50).map((e) => this.project(tx, e, actor.id))),
        next_cursor:
          rows.length > 50
            ? Buffer.from(
                JSON.stringify({
                  at: new Date(rows[49].created_at).toISOString(),
                  id: rows[49].id,
                  post: pid,
                }),
              ).toString('base64url')
            : null,
      };
    });
  }
  async create(actor: Actor, input: unknown, key: string) {
    const d = c.communityPostInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.eligible(tx, actor.id);
      const old = await this.replay(tx, actor.id, 'post', key, d);
      if (old) return { id: old.result_id };
      await this.quota(tx, actor.id);
      const eid = id();
      await tx.query(
        'INSERT INTO community_entries(id,author_id,type,title,body) VALUES($1,$2,$3,$4,$5)',
        [eid, actor.id, d.type, d.title, d.body],
      );
      await this.references(tx, eid, d.topics, d.asset_ids);
      await this.remember(tx, actor.id, 'post', key, d, eid);
      return { id: eid };
    });
  }
  async edit(actor: Actor, eid: string, input: unknown, comment = false) {
    const d = comment
      ? c.communityCommentEditInput.parse(input)
      : c.communityEditInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.eligible(tx, actor.id);
      await this.quota(tx, actor.id);
      if (comment) {
        const hint = found(
          await one(tx, 'SELECT post_id FROM community_entries WHERE id=$1 AND author_id=$2', [
            eid,
            actor.id,
          ]),
        );
        await tx.query('SELECT community_lock_entry($1)', [hint.post_id]);
      }
      const e = found(
        await one(tx, 'SELECT * FROM community_entries WHERE id=$1 AND author_id=$2 FOR UPDATE', [
          eid,
          actor.id,
        ]),
      );
      check((e.type === 'comment') === comment, 'COMMUNITY_TYPE', 'Invalid content type.', 400);
      version(e, d.version);
      check(e.state !== 'deleted', 'COMMUNITY_DELETED', 'Deleted content cannot be edited.');
      if (comment)
        check(
          await one(
            tx,
            'SELECT id FROM community_entries WHERE id=$1 AND community_visible(id) AND NOT locked',
            [e.post_id],
          ),
          'COMMUNITY_LOCKED',
          'This thread is unavailable or locked.',
        );
      await this.snapshot(tx, e);
      if (!comment) {
        const post = d as z.infer<typeof c.communityEditInput>;
        check(
          post.type === e.type,
          'COMMUNITY_TYPE',
          'Post type cannot change after creation.',
          400,
        );
        await this.references(tx, eid, post.topics, post.asset_ids);
      }
      await tx.query(
        "UPDATE community_entries SET title=$2,body=$3,version=version+1,moderation=CASE WHEN moderation IN ('hidden','removed') THEN moderation ELSE 'pending' END,updated_at=now() WHERE id=$1",
        [eid, 'title' in d ? d.title : '', d.body],
      );
      return { ok: true };
    });
  }
  async publish(actor: Actor, eid: string, input: unknown) {
    const d = c.communityVersionInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.eligible(tx, actor.id);
      const e = found(
        await one(
          tx,
          'SELECT * FROM community_entries WHERE id=$1 AND author_id=$2 AND post_id IS NULL FOR UPDATE',
          [eid, actor.id],
        ),
      );
      if (e.state === 'published' && e.version === d.version + 1) return { ok: true };
      version(e, d.version);
      check(e.state === 'draft', 'COMMUNITY_STATE', 'Only a draft can be submitted.');
      await this.quota(tx, actor.id);
      const topicIds = (
        await tx.query(
          'SELECT topic_id FROM community_entry_topics WHERE entry_id=$1 ORDER BY topic_id',
          [eid],
        )
      ).rows;
      for (const topic of topicIds)
        await tx.query('SELECT community_lock_topic($1)', [topic.topic_id]);
      check(
        await one(
          tx,
          'SELECT 1 FROM community_entry_topics x JOIN community_topics t ON t.id=x.topic_id WHERE x.entry_id=$1 AND t.active',
          [eid],
        ),
        'COMMUNITY_TOPIC',
        'Select an active topic before publishing.',
      );
      check(
        !(await one(
          tx,
          'SELECT 1 FROM community_entry_topics x JOIN community_topics t ON t.id=x.topic_id WHERE x.entry_id=$1 AND NOT t.active',
          [eid],
        )),
        'COMMUNITY_TOPIC',
        'Remove archived topics before publishing.',
      );
      await tx.query(
        "UPDATE community_entries SET state='published',moderation='pending',version=version+1,published_at=now(),updated_at=now() WHERE id=$1",
        [eid],
      );
      return { ok: true };
    });
  }
  async remove(actor: Actor, eid: string, input: unknown) {
    const d = c.communityVersionInput.parse(input);
    return this.run(actor, async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
      const hint = found(
        await one(tx, 'SELECT * FROM community_entries WHERE id=$1 AND author_id=$2', [
          eid,
          actor.id,
        ]),
      );
      if (hint.post_id) await tx.query('SELECT community_lock_entry($1)', [hint.post_id]);
      const e = found(
        await one(tx, 'SELECT * FROM community_entries WHERE id=$1 AND author_id=$2 FOR UPDATE', [
          eid,
          actor.id,
        ]),
      );
      if (e.state === 'deleted') return { ok: true };
      version(e, d.version);
      await this.snapshot(tx, e);
      await tx.query(
        "UPDATE community_entries SET state='deleted',body='',title='',version=version+1,updated_at=now() WHERE id=$1",
        [eid],
      );
      return { ok: true };
    });
  }
  async comment(actor: Actor, pid: string, input: unknown, key: string) {
    const d = c.communityCommentInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.eligible(tx, actor.id);
      await tx.query('SELECT community_lock_entry($1)', [pid]);
      const p = found(
        await one(
          tx,
          'SELECT * FROM community_entries WHERE id=$1 AND post_id IS NULL AND community_visible(id)',
          [pid],
        ),
      );
      check(!p.locked, 'COMMUNITY_LOCKED', 'Replies are closed for this thread.');
      const old = await this.replay(tx, actor.id, `comment:${pid}`, key, d);
      if (old) return { id: old.result_id };
      await this.quota(tx, actor.id);
      if (d.parent_id) await tx.query('SELECT community_lock_entry($1)', [d.parent_id]);
      if (d.parent_id)
        found(
          await one(
            tx,
            'SELECT id FROM community_entries WHERE id=$1 AND post_id=$2 AND parent_id IS NULL AND community_visible(id)',
            [d.parent_id, pid],
          ),
        );
      const eid = id();
      await tx.query(
        "INSERT INTO community_entries(id,author_id,post_id,parent_id,type,body,state,published_at) VALUES($1,$2,$3,$4,'comment',$5,'published',now())",
        [eid, actor.id, pid, d.parent_id, d.body],
      );
      await this.remember(tx, actor.id, `comment:${pid}`, key, d, eid);
      return { id: eid };
    });
  }
  async relation(actor: Actor, input: unknown) {
    const d = c.communityRelationInput.parse(input);
    return this.run(actor, async (tx) => {
      if (!d.enabled) {
        await tx.query(
          'DELETE FROM community_relations WHERE user_id=$1 AND kind=$2 AND target=$3',
          [actor.id, d.kind, d.target],
        );
        return { ok: true };
      }
      this.reading();
      if (d.kind === 'like') await this.eligible(tx, actor.id);
      await this.quota(tx, actor.id, 'interest', 200);
      let entry: string | null = null,
        topic: string | null = null,
        profile: string | null = null;
      if (d.kind === 'like' || d.kind === 'save') {
        const e = found(
          await one(
            tx,
            'SELECT id,post_id FROM community_entries WHERE id=$1 AND community_visible(id)',
            [d.target],
          ),
        );
        check(
          d.kind !== 'save' || !e.post_id,
          'COMMUNITY_TARGET',
          'Save a post, not a comment.',
          400,
        );
        entry = d.target;
      } else if (d.kind === 'mute_user') {
        found(
          await one(
            tx,
            'SELECT public_id FROM community_profiles WHERE public_id=$1 AND user_id<>$2',
            [d.target, actor.id],
          ),
        );
        profile = d.target;
      } else {
        found(await one(tx, 'SELECT id FROM community_topics WHERE id=$1 AND active', [d.target]));
        topic = d.target;
      }
      await tx.query(
        'INSERT INTO community_relations(user_id,kind,target,entry_id,topic_id,profile_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [actor.id, d.kind, d.target, entry, topic, profile],
      );
      return { ok: true };
    });
  }
  async report(actor: Actor, input: unknown) {
    const d = c.communityReportInput.parse(input);
    return this.run(actor, async (tx) => {
      await tx.query('SELECT community_lock_entry($1)', [d.entry_id]);
      found(
        await one(
          tx,
          'SELECT id FROM community_entries WHERE id=$1 AND (community_visible(id) OR author_id=$2)',
          [d.entry_id, actor.id],
        ),
      );
      const old = await one(
        tx,
        "SELECT id FROM community_reports WHERE reporter_id=$1 AND entry_id=$2 AND state='open'",
        [actor.id, d.entry_id],
      );
      if (old) return old;
      await this.quota(tx, actor.id, 'report', 20);
      const rid = id();
      const r = await one(
        tx,
        "INSERT INTO community_reports(id,reporter_id,entry_id,category,explanation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(reporter_id,entry_id) WHERE state='open' DO UPDATE SET entry_id=EXCLUDED.entry_id RETURNING id",
        [rid, actor.id, d.entry_id, d.category, d.explanation],
      );
      return r;
    });
  }
  async recovery(actor: Actor) {
    return this.run(actor, async (tx) => ({
      reports: (
        await tx.query(
          'SELECT id,entry_id,category,explanation,state,created_at FROM community_reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT 100',
          [actor.id],
        )
      ).rows,
      actions: (
        await tx.query(
          'SELECT id,entry_id,action,reason,created_at FROM community_actions WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 100',
          [actor.id],
        )
      ).rows,
      appeals: (
        await tx.query(
          'SELECT id,action_id,statement,state,reason,version FROM community_appeals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
          [actor.id],
        )
      ).rows,
    }));
  }
  async appeal(actor: Actor, input: unknown) {
    const d = c.communityAppealInput.parse(input);
    return this.run(actor, async (tx) => {
      found(
        await one(tx, 'SELECT id FROM community_actions WHERE id=$1 AND subject_id=$2', [
          d.action_id,
          actor.id,
        ]),
      );
      await this.quota(tx, actor.id, 'appeal', 20);
      const result = await one(
        tx,
        'INSERT INTO community_appeals(id,action_id,user_id,statement) VALUES($1,$2,$3,$4) ON CONFLICT(action_id) DO UPDATE SET action_id=EXCLUDED.action_id RETURNING id',
        [id(), d.action_id, actor.id, d.statement],
      );
      return result;
    });
  }
  async notifications(actor: Actor) {
    return this.run(actor, async (tx) => ({
      items: (
        await tx.query(
          `SELECT n.id,n.kind,n.created_at,CASE WHEN community_visible(e.id) THEN COALESCE(e.post_id,e.id) ELSE NULL END AS post_id FROM community_notifications n JOIN community_entries e ON e.id=n.entry_id JOIN community_profiles recipient ON recipient.user_id=n.user_id WHERE n.user_id=$1 AND (n.kind='moderation' OR (recipient.reply_notifications AND community_visible(e.id) AND NOT EXISTS(SELECT 1 FROM community_relations r WHERE r.user_id=$1 AND ((r.kind='mute_user' AND r.profile_id=(SELECT public_id FROM community_profiles WHERE user_id=e.author_id)) OR (r.kind='mute_topic' AND r.topic_id IN (SELECT topic_id FROM community_entry_topics WHERE entry_id=COALESCE(e.post_id,e.id))))))) ORDER BY n.created_at DESC LIMIT 100`,
          [actor.id],
        )
      ).rows,
    }));
  }
  async queue(actor: Actor) {
    return this.run(actor, async (tx) => {
      await this.authority(tx, actor);
      return {
        entries: (
          await tx.query(
            "SELECT e.*,p.display_name FROM community_entries e JOIN community_profiles p ON p.user_id=e.author_id WHERE e.state='published' AND (e.moderation<>'visible' OR EXISTS(SELECT 1 FROM community_reports r WHERE r.entry_id=e.id AND r.state='open')) ORDER BY CASE WHEN EXISTS(SELECT 1 FROM community_reports pending_report WHERE pending_report.entry_id=e.id AND pending_report.state='open') THEN 0 WHEN e.moderation='pending' THEN 1 ELSE 2 END,e.updated_at,e.id LIMIT 100",
          )
        ).rows,
        reports: (
          await tx.query(
            "SELECT id,entry_id,category,explanation,created_at,reporter_id FROM community_reports WHERE state='open' ORDER BY created_at LIMIT 100",
          )
        ).rows,
        appeals: (
          await tx.query(
            "SELECT a.*,m.actor_id AS original_reviewer,m.entry_id,m.action FROM community_appeals a JOIN community_actions m ON m.id=a.action_id WHERE a.state='open' ORDER BY a.created_at LIMIT 100",
          )
        ).rows,
        suggestions: (
          await tx.query(
            'SELECT id,name,description,created_at FROM community_suggestions ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      };
    });
  }
  async topic(actor: Actor, input: unknown) {
    const d = c.communityTopicInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.authority(tx, actor);
      await tx.query(
        'INSERT INTO community_topics(id,name,description,active) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,active=$4',
        [d.slug, d.name, d.description, d.active],
      );
      await audit(tx, actor.id, 'community.topic', d.slug, { active: d.active });
      return { ok: true };
    });
  }
  async decide(actor: Actor, eid: string, input: unknown) {
    const d = c.communityDecisionInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.authority(tx, actor);
      const hint = found(await one(tx, 'SELECT * FROM community_entries WHERE id=$1', [eid]));
      check(
        hint.author_id !== actor.id,
        'COMMUNITY_SELF_REVIEW',
        'Another moderator must review your content.',
        403,
      );
      check(
        !(await one(tx, 'SELECT 1 FROM community_reports WHERE entry_id=$1 AND reporter_id=$2', [
          eid,
          actor.id,
        ])),
        'COMMUNITY_SELF_REVIEW',
        'Another moderator must review content you reported.',
        403,
      );
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [hint.author_id]);
      if (hint.post_id) await tx.query('SELECT community_lock_entry($1)', [hint.post_id]);
      const e = found(
        await one(tx, 'SELECT * FROM community_entries WHERE id=$1 FOR UPDATE', [eid]),
      );
      version(e, d.version);
      check(e.state === 'published', 'COMMUNITY_STATE', 'Only submitted content can be moderated.');
      if (d.action === 'approve') {
        await this.eligible(tx, e.author_id, false);
        if (e.post_id)
          check(
            await one(
              tx,
              'SELECT id FROM community_entries WHERE id=$1 AND community_visible(id) AND NOT locked',
              [e.post_id],
            ),
            'COMMUNITY_LOCKED',
            'Parent thread must be visible and open.',
          );
        if (e.parent_id)
          found(
            await one(
              tx,
              'SELECT id FROM community_entries WHERE id=$1 AND community_visible(id)',
              [e.parent_id],
            ),
          );
      }
      const aid = id();
      await tx.query(
        'INSERT INTO community_actions(id,entry_id,subject_id,actor_id,action,reason,entry_version) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [aid, eid, e.author_id, actor.id, d.action, d.reason, e.version + 1],
      );
      if (d.action === 'restrict')
        await tx.query(
          "INSERT INTO community_sanctions(user_id,action_id,until_at) VALUES($1,$2,now()+($3::int*interval '1 day')) ON CONFLICT(user_id) DO UPDATE SET action_id=$2,until_at=EXCLUDED.until_at",
          [e.author_id, aid, d.days],
        );
      if (d.action === 'restore_posting')
        await tx.query('DELETE FROM community_sanctions WHERE user_id=$1', [e.author_id]);
      const state = { approve: 'visible', hide: 'hidden', remove: 'removed' }[
        d.action as 'approve' | 'hide' | 'remove'
      ];
      await tx.query(
        'UPDATE community_entries SET moderation=COALESCE($2,moderation),locked=COALESCE($3,locked),version=version+1,updated_at=now() WHERE id=$1',
        [eid, state || null, d.action === 'lock' ? true : d.action === 'unlock' ? false : null],
      );
      await tx.query(
        "UPDATE community_reports SET state='resolved' WHERE entry_id=$1 AND state='open'",
        [eid],
      );
      await this.event(tx, e, 'moderation');
      if (d.action === 'approve' && e.post_id && e.moderation !== 'visible')
        await this.event(tx, e, 'reply');
      await audit(tx, actor.id, 'community.moderated', eid, { action: d.action, action_id: aid });
      return { ok: true };
    });
  }
  async decideAppeal(actor: Actor, aid: string, input: unknown) {
    const d = c.communityAppealDecisionInput.parse(input);
    return this.run(actor, async (tx) => {
      await this.authority(tx, actor);
      const a = found(
        await one(
          tx,
          'SELECT a.*,m.actor_id,m.subject_id,m.entry_id,m.action,m.entry_version FROM community_appeals a JOIN community_actions m ON m.id=a.action_id WHERE a.id=$1 FOR UPDATE OF a',
          [aid],
        ),
      );
      version(a, d.version);
      check(a.state === 'open', 'COMMUNITY_STATE', 'Appeal is already closed.');
      check(
        a.actor_id !== actor.id && a.subject_id !== actor.id,
        'COMMUNITY_SELF_REVIEW',
        'An independent moderator must decide this appeal.',
        403,
      );
      check(
        !(await one(tx, 'SELECT 1 FROM community_reports WHERE entry_id=$1 AND reporter_id=$2', [
          a.entry_id,
          actor.id,
        ])),
        'COMMUNITY_SELF_REVIEW',
        'Another moderator must decide this appeal.',
        403,
      );
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [a.subject_id]);
      const hint = found(
        await one(tx, 'SELECT post_id FROM community_entries WHERE id=$1', [a.entry_id]),
      );
      if (hint.post_id) await tx.query('SELECT community_lock_entry($1)', [hint.post_id]);
      const e = found(
        await one(tx, 'SELECT * FROM community_entries WHERE id=$1 FOR UPDATE', [a.entry_id]),
      );
      if (d.decision === 'overturn') {
        check(
          e.version === a.entry_version,
          'COMMUNITY_STALE',
          'Content changed after this decision. Review the current content separately.',
        );
        if (a.action === 'restrict')
          await tx.query('DELETE FROM community_sanctions WHERE user_id=$1 AND action_id=$2', [
            a.subject_id,
            a.action_id,
          ]);
        else {
          check(
            ['hide', 'remove', 'lock'].includes(a.action),
            'COMMUNITY_APPEAL_ACTION',
            'This action requires a separate current moderation review.',
          );
          check(e.state === 'published', 'COMMUNITY_STATE', 'Deleted content cannot be restored.');
          await this.eligible(tx, a.subject_id, false);
          if (e.post_id)
            found(
              await one(
                tx,
                'SELECT id FROM community_entries WHERE id=$1 AND community_visible(id)',
                [e.post_id],
              ),
            );
          // Successful appeal returns content to review rather than automatically republishing a changed thread.
          await tx.query(
            "UPDATE community_entries SET moderation=CASE WHEN $2='lock' THEN moderation ELSE 'pending' END,locked=CASE WHEN $2='lock' THEN false ELSE locked END,version=version+1,updated_at=now() WHERE id=$1",
            [e.id, a.action],
          );
        }
      }
      await tx.query(
        'UPDATE community_appeals SET state=$2,reviewer_id=$3,reason=$4,version=version+1 WHERE id=$1',
        [aid, d.decision === 'uphold' ? 'upheld' : 'overturned', actor.id, d.reason],
      );
      await this.event(tx, e, 'moderation');
      await audit(tx, actor.id, 'community.appeal_decided', aid, { decision: d.decision });
      return { ok: true };
    });
  }
}

// Called by the worker role; only generic target references are persisted.
export async function deliverCommunityNotifications(tx: SQL, event: Row) {
  const e = await one(tx, 'SELECT * FROM community_entries WHERE id=$1', [event.payload.entry_id]);
  if (!e) return;
  let recipients: string[] = [];
  if (event.payload.kind === 'moderation') recipients = [e.author_id];
  else {
    if (!(await one(tx, 'SELECT community_visible($1) AS visible', [e.id]))?.visible) return;
    recipients = (
      await tx.query('SELECT DISTINCT author_id FROM community_entries WHERE id=$1 OR id=$2', [
        e.post_id,
        e.parent_id,
      ])
    ).rows
      .map((r) => r.author_id)
      .filter((uid) => uid !== e.author_id);
  }
  for (const uid of recipients) {
    const p = await one(
      tx,
      'SELECT p.reply_notifications FROM community_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND u.closed_at IS NULL',
      [uid],
    );
    if (!p || (event.payload.kind === 'reply' && !p.reply_notifications)) continue;
    if (
      event.payload.kind === 'reply' &&
      (await one(
        tx,
        `SELECT 1 FROM community_relations r WHERE r.user_id=$1 AND ((r.kind='mute_user' AND r.profile_id=(SELECT public_id FROM community_profiles WHERE user_id=$2)) OR (r.kind='mute_topic' AND r.topic_id IN (SELECT topic_id FROM community_entry_topics WHERE entry_id=$3)))`,
        [uid, e.author_id, e.post_id],
      ))
    )
      continue;
    await tx.query(
      'INSERT INTO community_notifications(id,event_id,user_id,entry_id,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING',
      [id(), `${event.id}:${uid}`, uid, e.id, event.payload.kind],
    );
  }
}
export async function communityWorker(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query(
      "DELETE FROM community_revisions r WHERE r.created_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM community_reports p WHERE p.entry_id=r.entry_id AND p.state='open') AND NOT EXISTS(SELECT 1 FROM community_appeals a JOIN community_actions m ON m.id=a.action_id WHERE m.entry_id=r.entry_id AND a.state='open')",
    );
    const events = (
      await tx.query(
        "SELECT * FROM outbox WHERE type='community_notification' AND processed_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const event of events) {
      await deliverCommunityNotifications(tx, event);
      await tx.query('UPDATE outbox SET processed_at=now() WHERE id=$1', [event.id]);
    }
  });
}
export async function exportCommunity(tx: SQL, uid: string) {
  return {
    profile:
      (await one(
        tx,
        'SELECT public_id,display_name,bio,reply_notifications FROM community_profiles WHERE user_id=$1',
        [uid],
      )) || null,
    entries: (
      await tx.query(
        'SELECT id,post_id,parent_id,type,title,body,state,moderation,version,created_at,updated_at FROM community_entries WHERE author_id=$1',
        [uid],
      )
    ).rows,
    revisions: (
      await tx.query(
        'SELECT entry_id,version,title,body,created_at FROM community_revisions WHERE author_id=$1',
        [uid],
      )
    ).rows,
    preferences: (
      await tx.query('SELECT kind,target FROM community_relations WHERE user_id=$1', [uid])
    ).rows,
    acceptances: (
      await tx.query('SELECT version,accepted_at FROM community_acceptances WHERE user_id=$1', [
        uid,
      ])
    ).rows,
    reports: (
      await tx.query(
        'SELECT id,entry_id,category,explanation,state,created_at FROM community_reports WHERE reporter_id=$1',
        [uid],
      )
    ).rows,
    appeals: (
      await tx.query(
        'SELECT id,action_id,statement,state,reason,created_at FROM community_appeals WHERE user_id=$1',
        [uid],
      )
    ).rows,
  };
}
