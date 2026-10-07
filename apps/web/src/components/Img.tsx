import { useState } from 'react';

/** Remote property photo; falls back to a placeholder when the host refuses hotlinking or is down. */
export function Img({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className={`thumb-empty ${className ?? ''}`}>No image</div>;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={className} onError={() => setFailed(true)} />;
}
