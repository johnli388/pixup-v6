'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAction, useData, useSession, type Row } from './providers';
import { AccountGate, Badge, Empty, ErrorNotice, Loading, Modal, PageTitle, date } from './ui';
import { SecuritySettings } from './identity-access';
import { CommunitySamples } from './community-sample-preview';
import {
  communityGuidelines,
  communityGuidelinesVersion,
  communityTypes,
} from '../../../packages/domain/community';

function useRequestKey() {
  const ref = useRef({ body: '', key: '' });
  const key = (body: unknown) => {
    const value = JSON.stringify(body);
    if (value !== ref.current.body) ref.current = { body: value, key: crypto.randomUUID() };
    return ref.current.key;
  };
  key.reset = () => {
    ref.current = { body: '', key: '' };
  };
  return key;
}
const entryPath = (e: Row) => `/community/${e.post_id ? 'comments' : 'posts'}/${e.id}`;
export function CommunityHub() {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Empty
        title="Community Hub"
        description="Discuss IP cards, share your collecting stories and learn from other members. Sign in to join the member-only pilot. No purchase or subscription is required."
      >
        <Link className="button" href="/login">
          Sign in to Community
        </Link>
      </Empty>
    );
  if (user.mfa_required) return <SecuritySettings />;
  return (
    <AccountGate>
      <CommunityInner />
    </AccountGate>
  );
}
function CommunityInner() {
  const path = usePathname(),
    parts = path.split('/').filter(Boolean);
  const { data: me, error, isPending } = useData<Row>('/community/me');
  if (isPending) return <Loading />;
  if (!me) return <ErrorNotice error={error} />;
  return (
    <div className="community">
      <PageTitle
        eyebrow="PIXUP COMMUNITY"
        title="Every collection has a story."
        description="Ask questions, trade knowledge and find your people."
      />
      <nav aria-label="Community" className="community-actions">
        {[
          ['/community', 'Latest'],
          ['/community/following', 'Following'],
          ['/community/topics', 'Topics'],
          ['/community/samples', 'Sample community'],
          ['/community/mine', 'My posts'],
          ['/community/saved', 'Saved posts'],
          ['/community/notifications', 'Notifications'],
          ['/community/settings', 'Profile & guidelines'],
          ['/community/recovery', 'Reports & appeals'],
        ].map(([url, label]) => (
          <Link key={url} href={url} aria-current={path === url ? 'page' : undefined}>
            {label}
          </Link>
        ))}
        <Link className="button" href="/community/new">
          Write a post
        </Link>
      </nav>
      {!me.config.writes && (
        <p role="status" className="panel">
          Community contributions are paused. Your drafts, reports and appeals remain available.
        </p>
      )}
      {(!me.profile || !me.accepted) && (
        <p className="panel">
          Before posting,{' '}
          <Link href="/community/settings">
            choose your community name and accept the guidelines
          </Link>
          , then complete the {me.config.minimum_age}+ declaration in{' '}
          <Link href="/account/settings">account settings</Link>.
        </p>
      )}
      {me.sanction && (
        <p role="status">
          Posting restricted until {date(me.sanction.until_at)}. You can{' '}
          <Link href="/community/recovery">review the decision and appeal</Link>.
        </p>
      )}
      {parts[1] === 'samples' ? (
        <CommunitySamples key={path} />
      ) : parts[1] === 'settings' ? (
        <CommunitySettings me={me} />
      ) : parts[1] === 'recovery' ? (
        <Recovery />
      ) : parts[1] === 'notifications' ? (
        <Notifications />
      ) : parts[1] === 'new' ? (
        <Composer key="new" />
      ) : parts[1] === 'posts' && parts[2] ? (
        parts[3] === 'edit' ? (
          <LoadComposer key={parts[2]} id={parts[2]} />
        ) : (
          <Thread key={parts[2]} id={parts[2]} />
        )
      ) : parts[1] === 'topics' && !parts[2] ? (
        <Topics me={me} />
      ) : parts[1] === 'members' && parts[2] ? (
        <Member key={parts[2]} id={parts[2]} />
      ) : !me.config.enabled && parts[1] !== 'mine' ? (
        !parts[1] ? (
          <>
            <p className="panel">
              The member pilot is not open yet. Explore sample conversations below.
            </p>
            <CommunitySamples />
          </>
        ) : (
          <Empty
            title="Community is not open yet"
            description="The member pilot will appear here when it opens."
          />
        )
      ) : (
        <Feed
          key={path}
          feed={['mine', 'saved', 'following'].includes(parts[1]) ? parts[1] : 'latest'}
          topic={parts[1] === 'topics' ? parts[2] : undefined}
        />
      )}
    </div>
  );
}
function CommunitySettings({ me }: { me: Row }) {
  const action = useAction();
  const [name, setName] = useState(me.profile?.display_name || ''),
    [bio, setBio] = useState(me.profile?.bio || ''),
    [notifications, setNotifications] = useState(me.profile?.reply_notifications ?? true),
    [accept, setAccept] = useState(false);
  return (
    <section className="panel">
      <h2>Your community identity</h2>
      <p>Only the name and bio you choose here appear on your community profile.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await action.run(
            '/community/me/profile',
            { display_name: name, bio, reply_notifications: notifications },
            'Community profile saved.',
          );
        }}
      >
        <label>
          Community display name
          <input
            required
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          About your interests
          <textarea maxLength={600} value={bio} onChange={(e) => setBio(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />{' '}
          Notify me about replies
        </label>
        <button className="button" disabled={action.busy}>
          Save community profile
        </button>
      </form>
      <h3>Community guidelines</h3>
      <p>{communityGuidelines}</p>
      {me.accepted ? (
        <p>Accepted · {communityGuidelinesVersion}</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await action.run(
              '/community/guidelines/accept',
              { version: communityGuidelinesVersion, accepted: true },
              'Community guidelines accepted.',
            );
          }}
        >
          <label>
            <input
              required
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
            />{' '}
            I agree to these community guidelines
          </label>
          <button className="button" disabled={!accept || action.busy}>
            Accept guidelines
          </button>
        </form>
      )}
      <h3>Follow and mute preferences</h3>
      {me.relations.length === 0 ? (
        <p>No follows or mutes yet.</p>
      ) : (
        me.relations.map((r: Row) => (
          <p key={r.kind + r.target}>
            {r.kind.replaceAll('_', ' ')} · {r.target}{' '}
            <button
              disabled={action.busy}
              onClick={() =>
                action.run('/community/relations', { ...r, enabled: false }, 'Preference removed.')
              }
            >
              Remove
            </button>
          </p>
        ))
      )}
      <p>
        Export or request deletion of your community content from{' '}
        <Link href="/account/settings">account privacy settings</Link>.
      </p>
      <ErrorNotice error={action.error} />
    </section>
  );
}
function Topics({ me }: { me: Row }) {
  const { data, error, isPending } = useData<Row[]>('/community/topics');
  const action = useAction();
  return (
    <>
      <section className="community-grid">
        {isPending ? (
          <Loading />
        ) : (
          data?.map((t) => (
            <article className="panel" key={t.id}>
              <h2>
                <Link href={`/community/topics/${t.id}`}>{t.name}</Link>
              </h2>
              <p>{t.description}</p>
              {!t.active ? (
                <Badge>Archived</Badge>
              ) : (
                <div className="community-actions">
                  {['follow', 'mute_topic'].map((kind) => {
                    const enabled = me.relations.some(
                      (r: Row) => r.kind === kind && r.target === t.id,
                    );
                    return (
                      <button
                        key={kind}
                        disabled={action.busy}
                        onClick={() =>
                          action.run(
                            '/community/relations',
                            { kind, target: t.id, enabled: !enabled },
                            'Topic preference saved.',
                          )
                        }
                      >
                        {kind === 'follow'
                          ? enabled
                            ? 'Unfollow'
                            : 'Follow'
                          : enabled
                            ? 'Unmute'
                            : 'Mute'}{' '}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          ))
        )}
      </section>
      <ErrorNotice error={error || action.error} />
      <section className="panel">
        <h2>Suggest a topic</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              d = new FormData(form);
            if (
              await action.run(
                '/community/topic-suggestions',
                { name: d.get('name'), description: d.get('description') },
                'Topic suggestion sent.',
              )
            )
              form.reset();
          }}
        >
          <label>
            Topic name
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label>
            What would members discuss?
            <textarea name="description" required minLength={10} maxLength={600} />
          </label>
          <button className="button" disabled={action.busy}>
            Suggest topic
          </button>
        </form>
      </section>
    </>
  );
}
function Feed({
  feed = 'latest',
  topic,
  profile,
}: {
  feed?: string;
  topic?: string;
  profile?: string;
}) {
  const [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [type, setType] = useState(''),
    [cursor, setCursor] = useState('');
  const params = new URLSearchParams({
    feed,
    ...(topic ? { topic } : {}),
    ...(profile ? { profile } : {}),
    ...(query ? { q: query } : {}),
    ...(type ? { type } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const { data, error, isPending } = useData<Row>(`/community/posts?${params}`);
  if (
    !isPending &&
    !error &&
    data?.items.length === 0 &&
    feed === 'latest' &&
    !topic &&
    !profile &&
    !query &&
    !type &&
    !cursor
  ) {
    return (
      <>
        <p className="panel">
          No member posts yet. Explore these sample conversations while the community gets started.
        </p>
        <CommunitySamples />
      </>
    );
  }
  return (
    <section>
      <h2>
        {topic
          ? `Topic: ${topic.replaceAll('-', ' ')}`
          : feed === 'mine'
            ? 'My posts and drafts'
            : feed === 'saved'
              ? 'Saved posts'
              : feed === 'following'
                ? 'From topics you follow'
                : 'Latest conversations'}
      </h2>
      <form
        className="community-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
          setCursor('');
        }}
      >
        <label>
          Search community
          <input maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Post type
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setCursor('');
            }}
          >
            <option value="">All post types</option>
            {communityTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button className="button secondary">Search posts</button>
      </form>
      {isPending ? (
        <Loading />
      ) : !data ? (
        <ErrorNotice error={error} />
      ) : (
        <>
          {data.items.length === 0 ? (
            <Empty
              title={
                feed === 'following'
                  ? 'Follow a topic to start a conversation.'
                  : 'No posts here yet.'
              }
              description="Try another topic or share a story of your own."
            />
          ) : (
            data.items.map((post: Row) => <PostCard key={post.id} post={post} />)
          )}
          <div className="community-actions">
            {cursor && <button onClick={() => setCursor('')}>Back to newest</button>}
            {data.next_cursor && (
              <button onClick={() => setCursor(data.next_cursor)}>Next posts</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function Author({ entry }: { entry: Row }) {
  return (
    <span>
      {entry.author ? (
        <Link href={`/community/members/${entry.author.public_id}`}>
          {entry.author.display_name}
        </Link>
      ) : (
        'Deleted member'
      )}{' '}
      · {date(entry.created_at)}
      {entry.version > 2 ? ' · edited/reviewed' : ''}
    </span>
  );
}
function PostCard({ post }: { post: Row }) {
  return (
    <article className="panel">
      <div className="community-actions">
        <Badge>{post.type}</Badge>
        {post.own && <Badge>{post.state === 'draft' ? 'Draft' : post.moderation}</Badge>}
      </div>
      <h3>
        <Link href={`/community/posts/${post.id}`}>{post.title}</Link>
      </h3>
      <Author entry={post} />
      <p className="community-body">
        {post.body.slice(0, 280)}
        {post.body.length > 280 ? '…' : ''}
      </p>
      <div className="community-actions">
        {post.topics.map((t: Row) => (
          <Link key={t.id} href={`/community/topics/${t.id}`}>
            {t.name}
          </Link>
        ))}
        <span>{post.likes} likes</span>
      </div>
    </article>
  );
}
function LoadComposer({ id }: { id: string }) {
  const { data, error, isPending } = useData<Row>(`/community/posts/${id}`);
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  if (!data.own) return <ErrorNotice error="Only the author can edit this post." />;
  return <Composer initial={data} />;
}
function Composer({ initial }: { initial?: Row }) {
  const { data: topics } = useData<Row[]>('/community/topics');
  const { data: catalog } = useData<Row>('/catalog');
  const action = useAction(),
    router = useRouter(),
    key = useRequestKey();
  const { request, refresh } = useSession();
  const [saved, setSaved] = useState<Row | undefined>(initial),
    [title, setTitle] = useState(initial?.title || ''),
    [body, setBody] = useState(initial?.body || ''),
    [type, setType] = useState(initial?.type || 'discussion'),
    [selected, setSelected] = useState<string[]>(initial?.topics.map((t: Row) => t.id) || []),
    [assets, setAssets] = useState<string[]>(
      initial?.links.filter((a: Row) => a.id).map((a: Row) => a.id) || [],
    ),
    [preview, setPreview] = useState(false),
    [status, setStatus] = useState(''),
    [autoError, setAutoError] = useState(''),
    [autoPaused, setAutoPaused] = useState(false);
  const payload = { type, title, body, topics: selected, asset_ids: assets },
    signature = JSON.stringify(payload),
    lastSaved = useRef(initial ? signature : ''),
    saving = useRef(false);
  const valid = title.trim().length >= 3 && body.trim().length > 0 && selected.length > 0;
  useEffect(() => {
    if (
      autoPaused ||
      !saved ||
      saved.state !== 'draft' ||
      signature === lastSaved.current ||
      !valid
    )
      return;
    const timer = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      setStatus('Saving draft…');
      try {
        await request(`/community/posts/${saved.id}/edit`, {
          ...JSON.parse(signature),
          version: saved.version,
        });
        lastSaved.current = signature;
        setSaved({ ...saved, version: saved.version + 1 });
        setStatus('Draft saved');
        setAutoError('');
      } catch (e) {
        setAutoError(e instanceof Error ? e.message : 'Draft could not be saved.');
        setStatus('Draft not saved');
        setAutoPaused(true);
      } finally {
        saving.current = false;
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [signature, saved, valid, request, autoPaused]);
  const save = async () => {
    if (saving.current) return null;
    saving.current = true;
    try {
      let record = saved;
      if (record) {
        if (signature !== lastSaved.current) {
          const result = await action.run(`/community/posts/${record.id}/edit`, {
            ...payload,
            version: record.version,
          });
          if (!result) return null;
          record = { ...record, version: record.version + 1 };
        }
      } else {
        const result = await action.run('/community/posts', payload, undefined, key(payload));
        if (!result) return null;
        record = { id: result.id, version: 1, state: 'draft' };
      }
      lastSaved.current = signature;
      setSaved(record);
      setStatus('Draft saved');
      setAutoError('');
      setAutoPaused(false);
      return record;
    } finally {
      saving.current = false;
    }
  };
  const cards = Array.isArray(catalog?.items) ? catalog.items : [];
  return (
    <section className="panel">
      <h2>{initial ? 'Edit your post' : 'Share a story or start a discussion'}</h2>
      <p>
        Text only for this pilot. New posts and edited content enter moderator review. Your words
        remain in this editor if a request fails.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await save();
        }}
      >
        <label>
          Post type
          <select value={type} disabled={!!saved} onChange={(e) => setType(e.target.value)}>
            {communityTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            required
            minLength={3}
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Topics (choose up to three)</legend>
          {topics
            ?.filter((t) => t.active)
            .map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  disabled={!selected.includes(t.id) && selected.length >= 3}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id),
                    )
                  }
                />
                {t.name}
              </label>
            ))}
        </fieldset>
        <label>
          Your post
          <textarea
            required
            maxLength={20000}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label>
          Link a public card (optional)
          <select
            value=""
            disabled={assets.length >= 5}
            onChange={(e) => {
              if (e.target.value && !assets.includes(e.target.value))
                setAssets([...assets, e.target.value]);
            }}
          >
            <option value="">Choose a card</option>
            {cards.map((a: Row) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        {assets.map((a) => (
          <p key={a}>
            {cards.find((item: Row) => item.id === a)?.title || 'Linked card'}{' '}
            <button type="button" onClick={() => setAssets(assets.filter((x) => x !== a))}>
              Remove card
            </button>
          </p>
        ))}
        <div className="community-actions">
          <button className="button secondary" type="button" onClick={() => setPreview(!preview)}>
            {preview ? 'Close preview' : 'Preview post'}
          </button>
          <button className="button secondary" disabled={!valid || action.busy}>
            {saved?.state === 'published' ? 'Save edits for review' : 'Save draft'}
          </button>
          {saved?.state !== 'published' && (
            <button
              className="button"
              type="button"
              disabled={!valid || action.busy}
              onClick={async () => {
                const record = await save();
                if (
                  record &&
                  (await action.run(
                    `/community/posts/${record.id}/publish`,
                    { version: record.version },
                    'Submitted for review.',
                  ))
                ) {
                  await refresh();
                  router.push(`/community/posts/${record.id}`);
                }
              }}
            >
              Submit for review
            </button>
          )}
        </div>
      </form>
      <p role="status">{status}</p>
      <ErrorNotice error={action.error || autoError} />
      {autoError && saved && (
        <button
          onClick={async () => {
            const current = await request<Row>(`/community/posts/${saved.id}`);
            setSaved(current);
            setAutoError('');
            setStatus('Current version loaded. Review your unsent text before saving again.');
          }}
        >
          Load current version and keep my text
        </button>
      )}
      {preview && (
        <article className="panel">
          <h3>{title || 'Untitled preview'}</h3>
          <p className="community-body">{body}</p>
        </article>
      )}
      {saved && <Link href={`/community/posts/${saved.id}`}>View saved post</Link>}
    </section>
  );
}
function EntryActions({ entry, onReply }: { entry: Row; onReply?: () => void }) {
  const action = useAction();
  const [report, setReport] = useState(false),
    [deleting, setDeleting] = useState(false),
    [editing, setEditing] = useState(false),
    [body, setBody] = useState(entry.body);
  return (
    <>
      <div className="community-actions">
        {entry.state !== 'deleted' && (
          <>
            <button
              disabled={action.busy}
              onClick={() =>
                action.run('/community/relations', {
                  kind: 'like',
                  target: entry.id,
                  enabled: !entry.liked,
                })
              }
            >
              {entry.liked ? 'Unlike' : 'Like'} ({entry.likes})
            </button>
            {!entry.post_id && (
              <button
                disabled={action.busy}
                onClick={() =>
                  action.run('/community/relations', {
                    kind: 'save',
                    target: entry.id,
                    enabled: !entry.saved,
                  })
                }
              >
                {entry.saved ? 'Unsave' : 'Save post'}
              </button>
            )}
            {onReply && <button onClick={onReply}>Reply to comment</button>}
            <button onClick={() => setReport(true)}>Report</button>
            {entry.own ? (
              <>
                {entry.post_id ? (
                  <button onClick={() => setEditing(!editing)}>Edit comment</button>
                ) : (
                  <Link href={`/community/posts/${entry.id}/edit`}>Edit post</Link>
                )}
                <button onClick={() => setDeleting(true)}>
                  Delete {entry.post_id ? 'comment' : 'post'}
                </button>
              </>
            ) : (
              entry.author && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    action.run(
                      '/community/relations',
                      { kind: 'mute_user', target: entry.author.public_id, enabled: true },
                      'Member muted in your feeds and reply notifications.',
                    )
                  }
                >
                  Mute member
                </button>
              )
            )}
          </>
        )}
      </div>
      <ErrorNotice error={action.error} />
      {editing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                `${entryPath(entry)}/edit`,
                { version: entry.version, body },
                'Comment returned to review.',
              )
            )
              setEditing(false);
          }}
        >
          <label>
            Edit your comment
            <textarea
              required
              maxLength={3000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button className="button" disabled={action.busy}>
            Save comment
          </button>
        </form>
      )}
      {report && (
        <Modal title="Report community content" onClose={() => setReport(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              if (
                await action.run(
                  '/community/reports',
                  {
                    entry_id: entry.id,
                    category: d.get('category'),
                    explanation: d.get('explanation'),
                  },
                  'Report received. Your identity is private.',
                )
              )
                setReport(false);
            }}
          >
            <label>
              Reason
              <select name="category">
                {['spam', 'harassment', 'privacy', 'rights', 'inappropriate', 'other'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              What should the moderator know?
              <textarea name="explanation" required minLength={10} maxLength={2000} />
            </label>
            <button className="button" disabled={action.busy}>
              Send report
            </button>
            <ErrorNotice error={action.error} />
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete your content?" onClose={() => setDeleting(false)}>
          <p>
            {entry.post_id
              ? 'Your text will be removed. Existing replies may remain beneath a deletion placeholder.'
              : 'Deleting this post hides its entire thread from other members.'}{' '}
            Restricted revisions may be retained for up to 90 days, or while a report or appeal is
            open.
          </p>
          <button
            className="button"
            disabled={action.busy}
            onClick={async () => {
              if (
                await action.run(
                  `${entryPath(entry)}/delete`,
                  { version: entry.version },
                  'Content deleted.',
                )
              )
                setDeleting(false);
            }}
          >
            Confirm deletion
          </button>
          <ErrorNotice error={action.error} />
        </Modal>
      )}
    </>
  );
}
function Thread({ id }: { id: string }) {
  const { data: post, error, isPending } = useData<Row>(`/community/posts/${id}`);
  const [cursor, setCursor] = useState(''),
    [parent, setParent] = useState<Row | null>(null),
    [body, setBody] = useState('');
  const comments = useData<Row>(
    `/community/posts/${id}/comments?cursor=${encodeURIComponent(cursor)}`,
    post?.state === 'published' && post?.moderation === 'visible',
  );
  const action = useAction(),
    key = useRequestKey();
  if (isPending) return <Loading />;
  if (!post) return <ErrorNotice error={error} />;
  return (
    <>
      <article className="panel">
        <Badge>{post.type}</Badge>
        <h2>{post.title}</h2>
        <Author entry={post} />
        {post.own && (
          <p>
            Status:{' '}
            {post.state === 'draft'
              ? 'Draft'
              : post.state === 'deleted'
                ? 'Deleted'
                : post.moderation}
          </p>
        )}
        <p className="community-body">{post.body}</p>
        <p className="muted">Member contribution · not an official card assessment.</p>
        <div className="community-actions">
          {post.links.map((a: Row, i: number) =>
            a.id ? (
              <Link key={a.id} href={`/items/${a.id}`}>
                {a.title}
              </Link>
            ) : (
              <span key={i}>Linked item unavailable</span>
            ),
          )}
        </div>
        <EntryActions entry={post} />
      </article>
      {post.state === 'published' && post.moderation === 'visible' && (
        <section className="panel">
          <h2>Comments</h2>
          <ErrorNotice error={comments.error} />
          {comments.data?.items.length === 0 && <p>Be the first to share your experience.</p>}
          {comments.data?.items.map((comment: Row) => (
            <article
              id={`comment-${comment.id}`}
              className={`community-comment ${comment.parent_id ? 'community-reply' : ''}`}
              key={comment.id}
            >
              {comment.parent_id && <p className="muted">Reply to a comment in this thread</p>}
              <Author entry={comment} />
              <p className="community-body">
                {comment.state === 'deleted' ? 'Comment deleted' : comment.body}
              </p>
              {comment.own && comment.moderation !== 'visible' && (
                <p>Status: {comment.moderation}</p>
              )}
              <EntryActions
                entry={comment}
                onReply={
                  !comment.parent_id && !post.locked && comment.state !== 'deleted'
                    ? () => {
                        setParent(comment);
                        document.getElementById('community-reply')?.focus();
                      }
                    : undefined
                }
              />
            </article>
          ))}
          <div className="community-actions">
            {cursor && <button onClick={() => setCursor('')}>First comments</button>}
            {comments.data?.next_cursor && (
              <button onClick={() => setCursor(comments.data!.next_cursor)}>Next comments</button>
            )}
          </div>
          {post.locked ? (
            <p>Replies are closed for this thread.</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const payload = { body, parent_id: parent?.id || null };
                if (
                  await action.run(
                    `/community/posts/${id}/comments`,
                    payload,
                    'Comment submitted for review.',
                    key({ ...payload, nonce: parent?.id || id }),
                  )
                ) {
                  key.reset();
                  setBody('');
                  setParent(null);
                }
              }}
            >
              {parent && (
                <p>
                  Replying to {parent.author?.display_name || 'a member'}{' '}
                  <button type="button" onClick={() => setParent(null)}>
                    Cancel reply
                  </button>
                </p>
              )}
              <label>
                Your comment
                <textarea
                  id="community-reply"
                  required
                  maxLength={3000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <button className="button" disabled={action.busy}>
                Submit comment for review
              </button>
              <ErrorNotice error={action.error} />
            </form>
          )}
        </section>
      )}
    </>
  );
}
function Member({ id }: { id: string }) {
  const { data, error, isPending } = useData<Row>(`/community/profiles/${id}`);
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <>
      <section className="panel">
        <h2>{data.display_name}</h2>
        <p className="community-body">{data.bio}</p>
      </section>
      <Feed profile={id} />
    </>
  );
}
function Notifications() {
  const { data, error, isPending } = useData<Row>('/community/me/notifications');
  return (
    <section className="panel">
      <h2>Community notifications</h2>
      {isPending ? (
        <Loading />
      ) : !data ? (
        <ErrorNotice error={error} />
      ) : data.items.length === 0 ? (
        <p>No community notifications yet.</p>
      ) : (
        data.items.map((n: Row) => (
          <p key={n.id}>
            {n.kind === 'reply'
              ? 'A member replied to your conversation.'
              : 'A moderator reviewed your content or appeal.'}{' '}
            {n.kind === 'moderation' ? (
              <Link href="/community/recovery">View decision</Link>
            ) : (
              n.post_id && <Link href={`/community/posts/${n.post_id}`}>Open conversation</Link>
            )}{' '}
            · {date(n.created_at)}
          </p>
        ))
      )}
    </section>
  );
}
function Recovery() {
  const { data, error, isPending } = useData<Row>('/community/me/recovery');
  const action = useAction();
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>Reports and appeals</h2>
      <p>Your reports are private. A different moderator reviews appeals.</p>
      <h3>Your reports</h3>
      {data.reports.length === 0 && <p>No reports submitted.</p>}
      {data.reports.map((r: Row) => (
        <p key={r.id}>
          {r.category} · {r.state} · {r.explanation}
        </p>
      ))}
      <h3>Decisions about your content</h3>
      {data.actions.length === 0 && <p>No moderation decisions yet.</p>}
      {data.actions.map((a: Row) => (
        <article className="panel" key={a.id}>
          <h4>{a.action.replaceAll('_', ' ')}</h4>
          <p>{a.reason}</p>
          {data.appeals.some((r: Row) => r.action_id === a.id) ? (
            data.appeals
              .filter((r: Row) => r.action_id === a.id)
              .map((r: Row) => (
                <p key={r.id}>
                  Appeal: {r.state}. {r.reason}
                </p>
              ))
          ) : (
            <details>
              <summary>Appeal this decision</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  await action.run(
                    '/community/appeals',
                    { action_id: a.id, statement: d.get('statement') },
                    'Appeal sent to an independent reviewer.',
                  );
                }}
              >
                <label>
                  Why should we reconsider?
                  <textarea name="statement" required minLength={10} maxLength={2000} />
                </label>
                <button className="button secondary" disabled={action.busy}>
                  Submit appeal
                </button>
              </form>
            </details>
          )}
        </article>
      ))}
      <ErrorNotice error={action.error} />
    </section>
  );
}

export function CommunityModeration() {
  const { data, error, isPending } = useData<Row>('/ops/community');
  const action = useAction();
  const [lookup, setLookup] = useState('');
  const [target, setTarget] = useState('');
  const { data: lookedUp, error: lookupError } = useData<Row>(
    `/community/posts/${encodeURIComponent(target)}`,
    !!target,
  );
  if (isPending) return <Loading />;
  if (!data)
    return (
      <>
        <ErrorNotice error={error} />
        <Link href="/account/security">Verify your authenticator for moderation</Link>
      </>
    );
  const decision = (entry: Row) => (
    <article className="panel" key={entry.id}>
      <h3>{entry.title || 'Comment'}</h3>
      <p>
        By {entry.display_name || entry.author?.display_name} · {entry.moderation} · version{' '}
        {entry.version}
      </p>
      <p className="community-body">{entry.body}</p>
      {data.reports
        .filter((r: Row) => r.entry_id === entry.id)
        .map((r: Row) => (
          <p key={r.id}>
            Report: {r.category} · {r.explanation}
          </p>
        ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          await action.run(
            `/ops/community/entries/${entry.id}`,
            {
              version: entry.version,
              action: d.get('action'),
              reason: d.get('reason'),
              days: Number(d.get('days')),
            },
            'Moderation decision recorded.',
          );
        }}
      >
        <label>
          Decision
          <select name="action">
            {['approve', 'hide', 'remove', 'lock', 'unlock', 'restrict', 'restore_posting'].map(
              (a) => (
                <option key={a}>{a}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Posting restriction duration (days)
          <input type="number" name="days" min={1} max={30} defaultValue={7} />
        </label>
        <label>
          Reason shown to the author
          <textarea name="reason" required minLength={10} maxLength={2000} />
        </label>
        <button className="button" disabled={action.busy}>
          Record decision
        </button>
      </form>
    </article>
  );
  return (
    <section>
      <h2>Community moderation</h2>
      <p>
        Review content carefully. You cannot decide your own content, your reports or your own
        appealed decision.
      </p>
      <ErrorNotice error={action.error} />
      <form
        className="community-actions"
        onSubmit={(e) => {
          e.preventDefault();
          setTarget(lookup);
        }}
      >
        <label>
          Published post ID
          <input value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </label>
        <button>Find post to lock or review</button>
      </form>
      <ErrorNotice error={lookupError} />
      {lookedUp && decision(lookedUp)}
      {data.entries.length === 0 && <p>No content awaiting review.</p>}
      {data.entries.map(decision)}
      <h3>Independent appeals</h3>
      {data.appeals.map((a: Row) => (
        <article className="panel" key={a.id}>
          <p>
            {a.action}: {a.statement}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              await action.run(
                `/ops/community/appeals/${a.id}`,
                { version: a.version, decision: d.get('decision'), reason: d.get('reason') },
                'Appeal reviewed.',
              );
            }}
          >
            <label>
              Appeal decision
              <select name="decision">
                <option value="uphold">Uphold decision</option>
                <option value="overturn">Overturn decision (content returns to review)</option>
              </select>
            </label>
            <label>
              Appeal reason
              <textarea name="reason" required minLength={10} maxLength={2000} />
            </label>
            <button className="button" disabled={action.busy}>
              Review appeal
            </button>
          </form>
        </article>
      ))}
      <h3>Suggested topics</h3>
      {data.suggestions.map((s: Row) => (
        <p key={s.id}>
          {s.name} · {s.description}
        </p>
      ))}
      <details>
        <summary>Create or update a topic</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            await action.run(
              '/ops/community/topics',
              {
                slug: d.get('slug'),
                name: d.get('name'),
                description: d.get('description'),
                active: d.get('active') === 'on',
              },
              'Topic saved.',
            );
          }}
        >
          <label>
            Topic slug
            <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={60} />
          </label>
          <label>
            Topic name
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label>
            Description
            <textarea name="description" required minLength={10} maxLength={600} />
          </label>
          <label>
            <input name="active" type="checkbox" defaultChecked /> Active topic
          </label>
          <button className="button" disabled={action.busy}>
            Save topic
          </button>
        </form>
      </details>
    </section>
  );
}
