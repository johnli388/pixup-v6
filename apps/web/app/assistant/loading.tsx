'use client';
import { useI18n } from '../../components/i18n';
export default function AssistantLoading() {
  const { t: tr } = useI18n();

  return (
    <p className="loading" role="status">
      {tr('Opening Ask PixUP…')}
    </p>
  );
}
