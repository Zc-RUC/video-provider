export function parseAttributes(line) {
  const attributes = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of line.matchAll(pattern)) {
    attributes[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return attributes;
}

function absolute(uri, base) {
  return new URL(uri, base).toString();
}

function parseByteRange(value, previousEnd) {
  if (!value) return null;
  const [length, offset] = value.split('@').map(Number);
  if (!Number.isFinite(length)) return null;
  const start = Number.isFinite(offset) ? offset : previousEnd;
  if (!Number.isFinite(start)) return null;
  return { start, end: start + length - 1 };
}

export function parseMaster(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  let pending = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseAttributes(line.slice(18));
    } else if (pending && line.trim() && !line.startsWith('#')) {
      const resolution = pending.RESOLUTION?.split('x').map(Number) || [];
      variants.push({
        url: absolute(line.trim(), baseUrl),
        bandwidth: Number(pending.BANDWIDTH) || null,
        width: resolution[0] || null,
        height: resolution[1] || null,
        fps: Math.round(Number(pending['FRAME-RATE'])) || null,
        codecs: pending.CODECS || null,
      });
      pending = null;
    }
  }
  return variants;
}

export function parseMedia(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const result = {
    targetDuration: 6,
    mediaSequence: 0,
    endList: false,
    segments: [],
  };
  let duration = 0;
  let rangeValue = null;
  let previousEnd = 0;
  let key = null;
  let map = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      result.targetDuration = Number(line.slice(22)) || 6;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      result.mediaSequence = Number(line.slice(22)) || 0;
    } else if (line === '#EXT-X-ENDLIST') {
      result.endList = true;
    } else if (line.startsWith('#EXTINF:')) {
      duration = Number(line.slice(8).split(',')[0]) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      rangeValue = line.slice(17);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseAttributes(line.slice(11));
      key = attributes.METHOD === 'NONE' ? null : {
        method: attributes.METHOD,
        uri: attributes.URI ? absolute(attributes.URI, baseUrl) : null,
        iv: attributes.IV || null,
      };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attributes = parseAttributes(line.slice(11));
      map = {
        uri: absolute(attributes.URI, baseUrl),
        range: parseByteRange(attributes.BYTERANGE, 0),
      };
    } else if (line.trim() && !line.startsWith('#')) {
      const uri = absolute(line.trim(), baseUrl);
      const range = parseByteRange(rangeValue, previousEnd);
      if (range) previousEnd = range.end + 1;
      result.segments.push({
        sequence: result.mediaSequence + result.segments.length,
        uri,
        duration,
        range,
        key,
        map,
      });
      duration = 0;
      rangeValue = null;
    }
  }
  return result;
}
