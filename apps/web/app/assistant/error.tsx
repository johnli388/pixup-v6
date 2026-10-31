'use client';

export default function AssistantError({ retry }: { error: Error; retry: () => void }) {
  return (
    <section className="empty" role="alert">
      <h1>Ask PixUP couldn’t open.</h1>
      <p>Please try again. Your other PixUP pages are still available.</p>
      <button className="button" onClick={retry}>
        Try again
      </button>
    </section>
  );
}
