import { useEffect, useState } from 'react';
import { Music2, Video } from 'lucide-react';

const fallbackColors = ['#bd795f', '#7d8d79', '#a58265', '#7e8e9e', '#a17770', '#8d8067'];

function fallbackColor(title) {
  const hash = [...String(title || 'Downbit')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return fallbackColors[hash % fallbackColors.length];
}

export default function Thumbnail({ src, title, duration, progress = 100, kind = 'video', className = '', onTint }) {
  const [tint, setTint] = useState(() => fallbackColor(title));
  useEffect(() => {
    const fallback = fallbackColor(title);
    setTint(fallback);
    onTint?.(fallback);
    if (!src) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 12;
        canvas.height = 12;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, 12, 12);
        const pixels = context.getImageData(0, 0, 12, 12).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let weight = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const saturation = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
          const amount = 1 + saturation / 160;
          red += pixels[index] * amount;
          green += pixels[index + 1] * amount;
          blue += pixels[index + 2] * amount;
          weight += amount;
        }
        if (!cancelled && weight) {
          const color = `rgb(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(blue / weight)})`;
          setTint(color);
          onTint?.(color);
        }
      } catch {}
    };
    image.src = src;
    return () => { cancelled = true; };
  }, [src, title, onTint]);

  const visible = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 100;
  return (
    <div className={`thumbnail ${src ? 'has-image' : 'is-placeholder'} ${className}`} style={{ '--tint': tint }}>
      {src ? (
        <>
          <img className="thumbnail-gray" src={src} alt="" loading="lazy" />
          <img className="thumbnail-color" src={src} alt={title || '媒体封面'} loading="lazy" style={{ clipPath: `inset(${100 - visible}% 0 0 0)` }} />
        </>
      ) : (
        <div className="thumbnail-placeholder">
          <span className="placeholder-orbit" />
          {kind === 'audio' ? <Music2 size={30} strokeWidth={1.5} /> : <Video size={30} strokeWidth={1.5} />}
        </div>
      )}
      <span className="thumbnail-shade" />
      {duration != null && <span className="thumbnail-duration">{formatTime(duration)}</span>}
    </div>
  );
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
