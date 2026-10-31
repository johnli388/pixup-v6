'use client';
import { useI18n } from '../../components/i18n';

export default function AssistantError({ retry }: { error: Error; retry: () => void }) {
  const { t: tr } = useI18n();

  return (
    <section className="empty" role="alert">
      <h1>{tr('Ask PixUP couldn’t open.')}</h1>
      <p>{tr('Please try again. Your other PixUP pages are still available.')}</p>
      <button className="button" onClick={retry}>
        {tr('Try again')}
      </button>
    </section>
  );
}
