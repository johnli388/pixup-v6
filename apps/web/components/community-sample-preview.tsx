'use client';
import { useI18n } from './i18n';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Badge, Empty } from './ui';
import { communityTypes } from '../../../packages/domain/community';
import { communitySamplePosts, communitySampleTopics } from './community-samples';

const base = '/community/samples';

export function CommunitySamples() {
  const { t: tr, date, number, plural } = useI18n();

  const path = usePathname();
  // Preview URLs stay separate from member post, profile and topic endpoints.
  const [section, id] = path.startsWith(`${base}/`) ? path.slice(base.length + 1).split('/') : [];
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const topic =
    section === 'topics' && id ? communitySampleTopics.find((item) => item.id === id) : undefined;
  const post =
    section === 'posts' ? communitySamplePosts.find((item) => item.id === id) : undefined;
  const missing = (section === 'posts' && !post) || (section === 'topics' && id && !topic);
  const topicsOnly = section === 'topics' && !id;
  const matches = communitySamplePosts.filter(
    (item) =>
      (!topic || item.topics.includes(topic.id)) &&
      (!type || item.type === type) &&
      `${item.title} ${item.body} ${item.author}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section aria-label={tr('Sample community')}>
      <div className="notice subtle">
        <div>
          <strong>{tr('Sample community')}</strong>
          <p>
            {tr(
              'Explore fictional topics, stories and replies. Names and engagement counts are examples; this preview does not create member activity.',
            )}
          </p>
          <div className="community-actions">
            <Link href={base}>{tr('Sample conversations')}</Link>
            <Link href={`${base}/topics`}>{tr('Explore sample topics')}</Link>
            <Link href="/community/new">{tr('Write your own post')}</Link>
          </div>
        </div>
      </div>
      {missing ? (
        <Empty
          title={tr('Sample not found')}
          description={tr('Choose a sample conversation or topic above.')}
        />
      ) : post ? (
        <>
          <article className="panel">
            <Badge>{tr(post.type)}</Badge>
            <h2>{post.title}</h2>
            <p className="muted">
              {post.author} · {date(post.created_at)}
              {' · '}
              {tr('Sample member')}
            </p>
            <p className="community-body">{post.body}</p>
            <div className="community-actions">
              {post.topics.map((topicId) => (
                <Link key={topicId} href={`${base}/topics/${topicId}`}>
                  {communitySampleTopics.find((item) => item.id === topicId)?.name}
                </Link>
              ))}
              <span>{tr('{count} sample likes', { count: number(post.likes) })}</span>
            </div>
          </article>
          <h2>{tr('Sample replies ({count})', { count: number(post.replies.length) })}</h2>
          {post.replies.map((reply, index) => (
            <article key={`${post.id}-${index}`} className="panel community-comment">
              <strong>{reply.author}</strong>
              <p className="community-body">{reply.body}</p>
            </article>
          ))}
          <p className="muted">{tr('Replies and reactions are read-only in this preview.')}</p>
        </>
      ) : topicsOnly ? (
        <>
          <h2>{tr('Explore sample topics')}</h2>
          <div className="community-grid">
            {communitySampleTopics.map((item) => (
              <article className="panel" key={item.id}>
                <h3>
                  <Link href={`${base}/topics/${item.id}`}>{item.name}</Link>
                </h3>
                <p>{item.description}</p>
                <Badge>
                  {plural(
                    communitySamplePosts.filter((entry) => entry.topics.includes(item.id)).length,
                    '{count} sample post',
                    '{count} sample posts',
                  )}
                </Badge>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2>{topic ? topic.name : tr('Latest sample conversations')}</h2>
          {topic && <p>{topic.description}</p>}
          <div className="community-actions">
            <label>
              {tr('Search sample posts')}
              <input
                maxLength={120}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tr('Stories, cards, collecting…')}
              />
            </label>
            <label>
              {tr('Sample post type')}
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">{tr('All post types')}</option>
                {communityTypes.map((item) => (
                  <option key={item} value={item}>
                    {tr(item)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted" role="status">
            {plural(matches.length, '{count} sample post', '{count} sample posts')}
          </p>
          {matches.length ? (
            matches.map((item) => (
              <article className="panel" key={item.id}>
                <Badge>{tr(item.type)}</Badge>
                <h3>
                  <Link href={`${base}/posts/${item.id}`}>{item.title}</Link>
                </h3>
                <p className="muted">
                  {item.author} · {date(item.created_at)}
                </p>
                <p className="community-body">
                  {item.body.slice(0, 280)}
                  {item.body.length > 280 ? '…' : ''}
                </p>
                <div className="community-actions">
                  {item.topics.map((topicId) => (
                    <Link key={topicId} href={`${base}/topics/${topicId}`}>
                      {communitySampleTopics.find((entry) => entry.id === topicId)?.name}
                    </Link>
                  ))}
                  <span>{tr('{count} sample likes', { count: number(item.likes) })}</span>
                  <Link href={`${base}/posts/${item.id}`}>
                    {tr('{count} sample replies', { count: number(item.replies.length) })}
                  </Link>
                </div>
              </article>
            ))
          ) : (
            <Empty
              title={tr('No matching sample posts')}
              description={tr('Try another search or choose a different post type.')}
            />
          )}
        </>
      )}
    </section>
  );
}
