'use client';
import { useI18n } from './i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Bot, Search, Send, Sparkles, Trash2 } from 'lucide-react';
import { useData, useSession } from './providers';
import { AccountGate, Badge, ErrorNotice, PageTitle } from './ui';
import { CardArt } from './art';
import { SecuritySettings } from './identity-access';
import type { AssistantConfig, AssistantResponse } from '../../../packages/domain/assistant';

type Turn = { question: string; response: AssistantResponse };
const suggestions = [
  'Find sports cards under $100',
  'Show sellers with K-pop cards',
  'Find buyers from my sales',
  'Show my orders',
  'How do I sell a card?',
  'What is RePool?',
];

export function Assistant() {
  const { user } = useSession();
  return <AccountGate>{user?.mfa_required ? <SecuritySettings /> : <AssistantChat />}</AccountGate>;
}

function AssistantChat() {
  const { t: tr, money, locale } = useI18n();

  const { request } = useSession();
  const { data: config, error: configError } = useData<AssistantConfig>('/assistant/config');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [useAI, setUseAI] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (turns.length || pending)
      latest.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turns.length, pending]);

  async function send(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const question = (suggested ? tr(suggested) : message).trim();
    if (!question || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setPending(question);
    setError(null);
    try {
      const history = turns.slice(-3).flatMap((turn) => [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: turn.response.answer },
      ]);
      const response = await request<AssistantResponse>(
        '/assistant/messages',
        {
          message: question,
          locale,
          history,
          use_ai: useAI && !!config?.ai_available,
        },
        undefined,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setTurns((current) => [...current, { question, response }].slice(-20));
      setMessage('');
    } catch (cause) {
      if (!abort.signal.aborted) {
        setMessage(question);
        setError(
          cause instanceof Error ? cause : new Error('Unable to reach the assistant. Try again.'),
        );
      }
    } finally {
      if (!abort.signal.aborted) {
        controller.current = null;
        setPending('');
        input.current?.focus();
      }
    }
  }

  return (
    <>
      <PageTitle
        eyebrow={tr('YOUR COLLECTING COMPANION')}
        title={tr('Ask PixUP Guide')}
        description={tr(
          'Find your next card, explore sellers and get help with your collecting journey.',
        )}
      >
        <Badge>
          <Bot size={16} />{' '}
          {config?.ai_available && useAI ? tr('AI answers enabled') : tr('Search & help')}
        </Badge>
      </PageTitle>
      <div className="assistant-layout">
        <aside className="panel assistant-intro">
          <span className="assistant-emblem">
            <Sparkles size={28} />
          </span>
          <h2>
            {tr('A little guidance.')}
            <br />
            {tr('A great next find.')}
          </h2>
          <p>{tr('Ask about cards, prices, public sellers, your orders or how PixUP works.')}</p>
          <div className="assistant-suggestions">
            {suggestions.map((question) => (
              <button
                key={question}
                disabled={!!pending}
                onClick={() => void send(undefined, question)}
              >
                <Search size={15} />
                <span>{tr(question)}</span>
              </button>
            ))}
          </div>
          <p className="muted">
            {tr(
              'Buyer searches cover your own sales only. The guide can find information; purchases and account changes happen on their usual pages.',
            )}
          </p>
        </aside>
        <section className="panel assistant-chat" aria-label={tr('PixUP Guide chat')}>
          <div className="assistant-chat-heading">
            <h2>
              <Bot size={22} />
              {tr(' PixUP Guide')}
            </h2>
            <button
              className="text-link"
              disabled={!turns.length || !!pending}
              onClick={() => {
                setTurns([]);
                setError(null);
                setMessage('');
                input.current?.focus();
              }}
            >
              <Trash2 size={15} />
              {tr(' Clear chat')}
            </button>
          </div>
          <div
            className="assistant-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={tr('Conversation')}
          >
            {!turns.length && !pending && (
              <div className="assistant-welcome">
                <Bot size={32} />
                <h3>{tr('What would you like to discover?')}</h3>
                <p>{tr('Try “Find art cards under $80” or “How do I publish a collection?”')}</p>
              </div>
            )}
            {turns.map((turn, index) => (
              <div className="assistant-turn" key={index}>
                <p className="assistant-question">
                  <strong>{tr('You')}</strong>
                  {turn.question}
                </p>
                <div className="assistant-answer">
                  <span className="eyebrow">
                    {tr('PixUP Guide ·')}{' '}
                    {turn.response.mode === 'ai' ? tr('AI answer') : tr('Local search & help')}
                  </span>
                  <p>{turn.response.answer}</p>
                  {!!turn.response.notice && (
                    <p className="assistant-notice">{turn.response.notice}</p>
                  )}
                  <div className="assistant-results">
                    {turn.response.results.map((result, resultIndex) => (
                      <Link
                        key={`${result.href}-${resultIndex}`}
                        className="assistant-result"
                        href={result.href}
                      >
                        {result.artwork && <CardArt variant={result.artwork} />}
                        <span>
                          <small>{tr(result.kind)}</small>
                          <strong>{result.title}</strong>
                          <span>{result.description}</span>
                          {result.price_cents !== undefined && <b>{money(result.price_cents)}</b>}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {pending && (
              <div className="assistant-turn">
                <p className="assistant-question">
                  <strong>{tr('You')}</strong>
                  {pending}
                </p>
                <p role="status">{tr('Searching PixUP…')}</p>
              </div>
            )}
            <div ref={latest} />
          </div>
          <ErrorNotice error={error || configError} />
          <form className="assistant-compose" onSubmit={(event) => void send(event)}>
            <label htmlFor="assistant-question">{tr('Ask a question')}</label>
            <textarea
              id="assistant-question"
              ref={input}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={3}
              required
              disabled={!!pending}
              placeholder={tr(
                'Search a card, seller or buyer reference, or ask how something works…',
              )}
            />
            <div className="assistant-compose-actions">
              <small>{message.length}/2,000</small>
              <button className="button" disabled={!!pending || !message.trim()}>
                <Send size={16} />
                {pending ? tr('Searching…') : tr('Send message')}
              </button>
            </div>
          </form>
          {config?.ai_available ? (
            <label className="assistant-ai-option">
              <input
                type="checkbox"
                checked={useAI}
                disabled={!!pending}
                onChange={(event) => setUseAI(event.target.checked)}
              />
              <span>
                {tr(
                  'Use AI answers. Sends your message, recent chat and public search results to OpenAI. Buyer and order results stay local.',
                )}
              </span>
            </label>
          ) : (
            <p className="muted">
              {tr(
                'Local search and help are ready. AI answers become available when your administrator connects an AI provider.',
              )}
            </p>
          )}
          <p className="muted">
            {tr(
              'Chat stays in this page’s memory and clears when you leave or switch accounts. Don’t share passwords or payment details. Check item and order pages for current information.',
            )}
          </p>
        </section>
      </div>
    </>
  );
}
