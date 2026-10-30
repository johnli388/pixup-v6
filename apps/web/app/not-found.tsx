import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty">
      <h1>This page wandered off.</h1>
      <p>There are still plenty of good finds out there.</p>
      <Link className="button" href="/marketplace">
        Explore the marketplace
      </Link>
    </div>
  );
}
