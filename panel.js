const $ = id => document.getElementById(id);
let current = null;      // { videoId, title, segments, langs, lang }

function setStatus(msg, isError) {
  $('status').textContent = msg || '';
  $('status').className = isError ? 'error' : '';
}

function setBusy(busy) {
  ['fromLink', 'lang'].forEach(id => { $(id).disabled = busy; });
  if (busy) {
    $('output').value = '';
    $('output').placeholder = 'Getting transcript…';
    $('copy').disabled = $('download').disabled = true;
  } else {
    $('output').placeholder = 'Transcript will appear here…';
  }
}

function render() {
  if (!current) return;
  $('copy').disabled = $('download').disabled = false;
  $('title').textContent = current.title || 'Transcript';
  $('output').value = formatTranscript(current.segments, $('timestamps').checked);
  $('lineCount').textContent = `${current.segments.length} lines`;
  const langInfo = (current.langs || []).find(l => l.code === current.lang);
  $('langChip').textContent = langInfo ? langInfo.name : (current.lang || '');
  // Avoid repeating info that's already on screen.
  $('title').hidden = (current.title || '').trim() === $('videoTitle').textContent.trim();
  $('langChip').hidden = !!(current.langs && current.langs.length > 1);

  const sel = $('lang');
  if (current.langs && current.langs.length > 1) {
    sel.innerHTML = '';
    current.langs.forEach(l => {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.name;
      if (l.code === current.lang) o.selected = true;
      sel.appendChild(o);
    });
    sel.hidden = false;
  } else {
    sel.hidden = true;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const isYouTube = url => /^https:\/\/(www\.|m\.)?youtube\.com\//.test(url || '');

async function runInTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return res && res.result;
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, 30000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function scrapeViaPanel(videoId, activeTab) {
  // Use the open tab if it is already this video's watch page; otherwise open a background tab.
  if (activeTab && isYouTube(activeTab.url) && extractVideoId(activeTab.url) === videoId && /\/watch/.test(activeTab.url)) {
    return runInTab(activeTab.id, scrapeTranscriptFromPage);
  }
  const tab = await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false });
  try {
    await waitForTabLoad(tab.id);
    return await runInTab(tab.id, scrapeTranscriptFromPage);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

let requestId = 0;          // newest request wins (fast scrolling through Shorts)
let cardVideoId = null;    // video shown in the "This Short / This video" card

async function getTranscript(videoId, lang) {
  const myId = ++requestId;
  const stale = () => myId !== requestId;
  setBusy(true);
  setStatus('');
  try {
    const tab = await getActiveTab();
    let result = null;

    // 1) Fetch caption data from inside a YouTube tab (most reliable), else from the panel.
    if (tab && isYouTube(tab.url)) {
      try { result = await runInTab(tab.id, fetchTranscriptCore, [videoId, lang || '']); } catch (e) { result = null; }
    }
    if (stale()) return;
    if (!result || result.error) {
      try { result = await fetchTranscriptCore(videoId, lang || ''); } catch (e) { result = { error: e.message }; }
    }
    if (stale()) return;

    // 2) Fallback: read YouTube's transcript panel.
    if (!result || result.error) {
      setStatus('Trying YouTube\'s transcript panel…');
      try { result = await scrapeViaPanel(videoId, tab); } catch (e) { result = { error: e.message }; }
    }
    if (stale()) return;

    if (!result || result.error || !result.segments || !result.segments.length) {
      current = null;
      $('lineCount').textContent = ''; $('langChip').textContent = ''; $('title').textContent = '';
      $('lang').hidden = true;
      setStatus('No transcript found. This video may not have captions.', true);
      console.warn(result && result.error);
      return;
    }

    if (videoId === cardVideoId && result.title) $('videoTitle').textContent = result.title;
    current = { videoId, ...result };
    render();
    setStatus('');
  } finally {
    if (!stale()) setBusy(false);
  }
}

$('fromLink').addEventListener('click', () => {
  const id = extractVideoId($('link').value);
  if (!id) { setStatus('That doesn\'t look like a YouTube link.', true); return; }
  getTranscript(id);
});

$('link').addEventListener('keydown', e => { if (e.key === 'Enter') $('fromLink').click(); });
$('timestamps').addEventListener('change', render);
$('lang').addEventListener('change', () => { if (current) getTranscript(current.videoId, $('lang').value); });

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('output').value);
  setStatus('Copied to clipboard.');
});

$('download').addEventListener('click', () => {
  const name = ((current && current.title) || 'transcript').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'transcript';
  const blob = new Blob([$('output').value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Show the video open in the current tab and fetch its transcript.
// Runs on open, and again whenever you scroll to the next Short or switch tabs.
async function syncWithTab() {
  const tab = await getActiveTab();
  const id = tab && extractVideoId(tab.url);
  if (!id) { cardVideoId = null; $('videoCard').hidden = true; return; }
  if (id === cardVideoId) return;        // same video, nothing to do
  cardVideoId = id;
  $('videoLabel').textContent = /\/shorts\//.test(tab.url) ? 'This Short' : 'This video';
  $('videoTitle').textContent = cleanTitle(tab.title) || 'Loading…';
  $('thumb').style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/mqdefault.jpg")`;
  $('videoCard').hidden = false;
  if ($('autoFetch').checked) getTranscript(id);
}

const cleanTitle = t => (t || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();

let syncTimer = null;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncWithTab, 400); };

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const tab = await getActiveTab();
  if (!tab || tab.id !== tabId) return;
  if (info.url) scheduleSync();
  // YouTube updates the tab title a moment after the URL; keep the card title fresh.
  if (info.title && extractVideoId(tab.url) === cardVideoId && !(current && current.videoId === cardVideoId)) {
    $('videoTitle').textContent = cleanTitle(info.title);
  }
});
chrome.tabs.onActivated.addListener(scheduleSync);

// Remember the toggles.
try {
  $('autoFetch').checked = localStorage.getItem('autoFetch') !== '0';
  $('timestamps').checked = localStorage.getItem('timestamps') === '1';
} catch (e) {}
$('autoFetch').addEventListener('change', () => {
  try { localStorage.setItem('autoFetch', $('autoFetch').checked ? '1' : '0'); } catch (e) {}
  if ($('autoFetch').checked && cardVideoId && !(current && current.videoId === cardVideoId)) getTranscript(cardVideoId);
});
$('timestamps').addEventListener('change', () => {
  try { localStorage.setItem('timestamps', $('timestamps').checked ? '1' : '0'); } catch (e) {}
});
$('videoCard').addEventListener('click', () => { if (cardVideoId) getTranscript(cardVideoId); });

syncWithTab();
