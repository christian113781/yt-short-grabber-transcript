<p align="center">
  <img src="icons/icon128.png" alt="YouTube Transcript Grabber icon" width="96">
</p>

<h1 align="center">YouTube Transcript Grabber</h1>

<p align="center">
  A Chrome extension that pulls the transcript of any YouTube video or Short into a side panel, ready to copy or download as a <code>.txt</code> file.
</p>

---

## Features

- **Works on what you're watching.** Open the side panel on any YouTube video or Short and the transcript loads automatically.
- **Keeps up with Shorts.** The panel stays open while you scroll, and fetches the transcript for each new Short as it comes up.
- **Paste any link.** Grab a transcript without opening the video: `youtube.com/watch`, `youtu.be`, `/shorts/`, `/embed/`, `/live/`, or just the 11-character video ID.
- **Readable output.** Text is joined into paragraphs by default, or switch on **Timestamps** for one line per caption (`[1:23] ...`).
- **Language picker.** When a video has captions in several languages (including auto-generated ones), choose which one you want. English manual captions are picked first when available.
- **Copy or download.** One click to copy to the clipboard, or save as a `.txt` file named after the video.
- **Remembers your settings.** The Auto and Timestamps toggles are saved between sessions.

## Installation

The extension isn't on the Chrome Web Store, so you load it manually:

1. Download this repository (**Code → Download ZIP**) and unzip it, or clone it:
   ```bash
   git clone https://github.com/<your-username>/yt-transcript-grabber.git
   ```
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right corner).
4. Click **Load unpacked** and select the `yt-transcript-grabber` folder (the one containing `manifest.json`).
5. Pin the extension from the puzzle-piece menu so the icon is always in your toolbar.

Works in Chrome 114+ and other Chromium browsers that support the Side Panel API (Edge, Brave, etc.).

## Usage

1. Go to a YouTube video or Short.
2. Click the **Transcript Grabber** icon in the toolbar. The side panel opens and the transcript appears.
3. Use **Copy** or **Download .txt**.

To get a transcript for a different video, paste its link into the box at the top and press **Enter** (or the arrow button).

| Control | What it does |
| --- | --- |
| **Auto** | Fetch the transcript automatically when you open or scroll to a new video. Turn off to fetch only on demand. |
| **Video card** | Click it to fetch the current video's transcript again. |
| **Timestamps** | Show one timestamped line per caption instead of paragraphs. |
| **Language** | Appears when more than one caption track is available. |

## How it works

YouTube doesn't offer a public transcript API, so the extension tries three methods in order and uses the first that succeeds:

1. **Player API** – reads the caption track list from YouTube's internal player endpoint and downloads the caption file.
2. **Watch page data** – reads the caption tracks embedded in the video's watch page.
3. **Transcript panel** – as a last resort, opens YouTube's own **Show transcript** panel (in a background tab if needed) and reads the text from it.

Methods 1 and 2 run inside your open YouTube tab when possible, which is the most reliable route.

## Permissions

| Permission | Why it's needed |
| --- | --- |
| `sidePanel` | Shows the extension in Chrome's side panel. |
| `tabs`, `activeTab` | Detects which YouTube video is open in the current tab. |
| `scripting` | Runs the transcript-fetching code inside the YouTube tab. |
| `youtube.com`, `m.youtube.com` | Fetches caption data from YouTube. |

No data is collected or sent anywhere other than YouTube. There are no analytics and no external servers.

## Project structure

```
yt-transcript-grabber/
├── manifest.json     # Extension config (Manifest V3)
├── background.js     # Opens the side panel when the toolbar icon is clicked
├── panel.html        # Side panel UI
├── panel.css
├── panel.js          # Side panel logic (auto-fetch, Shorts tracking, copy/download)
├── transcript.js     # Shared helpers: link parsing, fetching, formatting
├── popup.html        # Older popup version of the UI (not used by the manifest)
├── popup.css
├── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Limitations

- Only works for videos that have captions (manual or auto-generated). If a video has none, you'll see *"No transcript found."*
- YouTube changes its internals from time to time, which can break one or more fetch methods until the extension is updated.
- Age-restricted, private, or members-only videos may not return a transcript.

## License

Add a license of your choice (for example, [MIT](https://choosealicense.com/licenses/mit/)) by creating a `LICENSE` file in the repository.
