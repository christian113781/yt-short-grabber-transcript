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

async function getTranscript(videoId, lang) {
  setBusy(true);
  setStatus('');
  try {
    const tab = await getActiveTab();
    let result = null;

    // 1) Fetch caption data from inside a YouTube tab (most reliable), else from the popup.
    if (tab && isYouTube(tab.url)) {
      try { result = await runInTab(tab.id, fetchTranscriptCore, [videoId, lang || '']); } catch (e) { result = null; }
    }
    if (!result || result.error) {
      try { result = await fetchTranscriptCore(videoId, lang || ''); } catch (e) { result = { error: e.message }; }
    }

    // 2) Fallback: read YouTube's transcript panel.
    if (!result || result.error) {
      setStatus('Trying YouTube\'s transcript panel…');
      try { result = await scrapeViaPanel(videoId, tab); } catch (e) { result = { error: e.message }; }
    }

    if (!result || result.error || !result.segments || !result.segments.length) {
      setStatus('No transcript found. The video may not have captions.', true);
      console.warn(result && result.error);
      return;
    }

    current = { videoId, ...result };
    render();
    setStatus('');
  } finally {
    setBusy(false);
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

// If a video is open, show its details and fetch the transcript right away.
getActiveTab().then(tab => {
  const id = tab && extractVideoId(tab.url);
  if (!id) return;                       // no video: card stays hidden
  $('videoLabel').textContent = /\/shorts\//.test(tab.url) ? 'This Short' : 'This video';
  $('videoTitle').textContent = (tab.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '') || id;
  $('thumb').style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/mqdefault.jpg")`;
  $('videoCard').hidden = false;
  getTranscript(id);
});
