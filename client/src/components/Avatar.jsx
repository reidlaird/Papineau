import { useState } from 'react';

export default function Avatar({ name, src, size = 44 }) {
  const [broken, setBroken] = useState(false);
  const initials = (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (!src || broken) {
    return (
      <div
        className="avatar avatar-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      >
        {initials}
      </div>
    );
  }
  return (
    <img
      className="avatar"
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
