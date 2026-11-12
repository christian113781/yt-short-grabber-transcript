// Shared helpers. fetchTranscriptCore and scrapeTranscriptFromPage are fully
// self-contained so they can also be injected into a YouTube tab.

function extractVideoId(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch (e) { /* not a URL */ }
  return null;
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatTranscript(segments, withTimestamps) {
  if (withTimestamps) {
    return segments.map(s => `[${s.time != null ? s.time : formatTime(s.start)}] ${s.text}`).join('\n');
  }
  // Join into readable paragraphs (~every 6 lines or at sentence end).
  const out = [];
  let para = [];
  segments.forEach(s => {
    para.push(s.text);
    if (para.length >= 6 && /[.!?]["')\]]?$/.test(s.text)) { out.push(para.join(' ')); para = []; }
  });
  if (para.length) out.push(para.join(' '));
  return out.join('\n\n');
}

// Method 1 + 2: YouTube's caption data. Returns {title, lang, langs, segments}.
async function fetchTranscriptCore(videoId, preferredLang) {
  const YT = 'https://www.youtube.com';

  const decode = str => str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  const clean = t => decode(decode(t)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  const parseXml = xml => {
    const segs = [];
    let m;
    const reText = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    while ((m = reText.exec(xml))) segs.push({ start: parseFloat(m[1]), text: clean(m[2]) });
    if (!segs.length) {
      const reP = /<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
      while ((m = reP.exec(xml))) segs.push({ start: parseInt(m[1], 10) / 1000, text: clean(m[2]) });
    }
    return segs.filter(s => s.text);
  };

  const parseJson3 = txt => {
    const j = JSON.parse(txt);
    return (j.events || [])
      .filter(e => e.segs)
      .map(e => ({ start: (e.tStartMs || 0) / 1000, text: e.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim() }))
      .filter(s => s.text);
  };

  const extractJson = (html, marker) => {
    const i = html.indexOf(marker);
    if (i < 0) return null;
    const start = html.indexOf('{', i);
    let depth = 0, inStr = false, esc = false;
    for (let k = start; k < html.length; k++) {
      const c = html[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, k + 1)); } catch (e) { return null; }
      }
    }
    return null;
  };

  const trackName = t => (t.name && (t.name.simpleText || (t.name.runs || []).map(r => r.text).join(''))) || t.languageCode;
  const pickTrack = tracks => {
    const want = (preferredLang || '').toLowerCase();
    if (want) {
      const exact = tracks.find(t => t.languageCode.toLowerCase() === want && t.kind !== 'asr') ||
                    tracks.find(t => t.languageCode.toLowerCase() === want);
      if (exact) return exact;
    }
    return tracks.find(t => t.languageCode.startsWith('en') && t.kind !== 'asr') ||
           tracks.find(t => t.languageCode.startsWith('en')) ||
           tracks.find(t => t.kind !== 'asr') || tracks[0];
  };
  const langList = tracks => tracks.map(t => ({ code: t.languageCode, name: trackName(t) + (t.kind === 'asr' && !/auto/i.test(trackName(t)) ? ' (auto)' : '') }));

  const html = await fetch(`${YT}/watch?v=${videoId}&hl=en`, { credentials: 'include' }).then(r => r.text());
  const pageData = extractJson(html, 'ytInitialPlayerResponse') || {};
  let title = (pageData.videoDetails && pageData.videoDetails.title) || '';
  const errors = [];

  // Method 1: InnerTube player API (Android client) -> caption XML.
  try {
    const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    if (!key) throw new Error('no API key');
    const res = await fetch(`${YT}/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } }, videoId })
    });
    const data = await res.json();
    title = title || (data.videoDetails && data.videoDetails.title) || '';
    const tracks = (((data.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
    if (!tracks.length) throw new Error('no caption tracks');
    const track = pickTrack(tracks);
    const xml = await fetch(track.baseUrl.replace('&fmt=srv3', '')).then(r => r.text());
    const segments = parseXml(xml);
    if (!segments.length) throw new Error('empty caption file');
    return { title, lang: track.languageCode, langs: langList(tracks), segments, method: 'api' };
  } catch (e) { errors.push('api: ' + e.message); }

  // Method 2: caption tracks listed on the watch page -> json3.
  try {
    const tracks = (((pageData.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
    if (!tracks.length) throw new Error('no caption tracks on page');
    const track = pickTrack(tracks);
    const txt = await fetch(track.baseUrl + '&fmt=json3', { credentials: 'include' }).then(r => r.text());
    if (!txt) throw new Error('empty caption file');
    const segments = parseJson3(txt);
    if (!segments.length) throw new Error('no text');
    return { title, lang: track.languageCode, langs: langList(tracks), segments, method: 'page' };
  } catch (e) { errors.push('page: ' + e.message); }

  return { error: errors.join('; '), title };
}

// Method 3: open YouTube's own "Show transcript" panel and read it.
// Runs inside a youtube.com/watch tab.
async function scrapeTranscriptFromPage() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, timeout) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(300); }
    return null;
  };
  const segQuery = 'ytd-transcript-segment-renderer, transcript-segment-view-model';

  await waitFor(() => document.querySelector('ytd-watch-metadata, #description'), 20000);
  if (!document.querySelector(segQuery)) {
    const expand = document.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand');
    if (expand) { expand.click(); await sleep(600); }
    const btn = await waitFor(() =>
      document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      [...document.querySelectorAll('button, yt-button-shape button')].find(b =>
        /show transcript|transcript/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || ''))), 10000);
    if (!btn) return { error: 'This video has no "Show transcript" button (no captions).' };
    btn.click();
  }
  const ok = await waitFor(() => document.querySelectorAll(segQuery).length, 20000);
  if (!ok) return { error: 'Transcript panel did not load.' };
  await sleep(1000);

  const segments = [...document.querySelectorAll(segQuery)].map(el => {
    const time = (el.querySelector('.segment-timestamp, [class*="Timestamp"], [class*="timestamp"]') || {}).textContent;
    const textEl = el.querySelector('.segment-text, yt-formatted-string.segment-text, [class*="SegmentText"], [role="text"]');
    let text = (textEl ? textEl.textContent : el.textContent) || '';
    if (!textEl && time) text = text.replace(time, '');
    return { time: (time || '').trim(), text: text.replace(/\s+/g, ' ').trim() };
  }).filter(s => s.text);

  const title = ((document.querySelector('ytd-watch-metadata h1') || {}).textContent || document.title.replace(/ - YouTube$/, '')).trim();
  return segments.length ? { title, segments, method: 'panel' } : { error: 'Transcript panel was empty.' };
}
