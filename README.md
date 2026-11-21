# Story Agent

Writes dramatic, mysterious story scripts for Reels, TikTok and Shorts, the kind people rewatch.
It's a website: nothing to install. Open it on your PC or phone, and it's always the newest version.

**Open it:** https://coder677777.github.io/story-agent/

## Two ways to start

1. **AI picks for me**: choose a style, add a theme if you want (soccer, little sister, Diwali…),
   and get 3, 6 or 9 original ideas. Tap a twist to read it, then press **Write this script**.
2. **From my prompt**: paste a viewer comment ("do one where grandpa comes back"), a "what if",
   or your own idea. Turn it into ideas first, or go straight to a full script.

## What a script includes

- Cover text for the thumbnail and the exact first line (the 3-second hook)
- 12–20 timed scenes: voiceover, what's on screen, camera, on-screen text, sound, and hidden clues
- The twist, the clue list, and the last line telling viewers what to rewatch
- Caption + hashtags, a comment to pin, and a tease for the next part
- Buttons: copy voiceover, copy full script, download, **Write Part 2**, and quick rewrites
  (more emotional, more mysterious, bigger twist, stronger hook, funnier, shorter, or type your own).
  **Undo** goes back if you don't like a rewrite.

Every script is saved in the **Library** in that browser.

## Styles

- **In our town** (proven): a strange town rule with a limit, a family story, a twist. This is the format that got
  @pov.deadlinestories from 1K to 1.8M plays.
- **Mystery clues**: a puzzle with fair clues hidden in plain sight.
- **Eerie but emotional**: creepy atmosphere where the scare turns out to be about love or loss.

## First time

The site asks for a free Gemini key (the same kind Clip Agent uses):
open https://aistudio.google.com/apikey, sign in, click **Create API key**, paste it in Settings.
The key stays in your browser and only goes to Google.

If the free key runs out for the day, the site gives you a prompt to paste into Claude and a box to paste
the answer back. You can also pick **Paste from Claude** in Settings to always work that way.

## Make the video

On any script press **🎬 Make the video**. It records the voiceover, gets a picture for each scene, lines up the timing,
and builds a vertical video with slow camera moves, big captions, on-screen labels, a hit sound on impact moments,
a rewind effect, music and an end card. Press **Play** to watch, then **Export video** to download an MP4.

- **Voice:** free with your Gemini key (about 10 a day; each video uses 1). Pick a voice and say how it should sound.
  Out of free voices? Press **Use my own recording** and upload an MP3.
- **🎬 AI video clips** (closest to @pov.deadlinestories): each scene gets a consistent picture, then Google's video model
  animates it into a moving clip. Paid on your Gemini key with billing on: about 7¢ a second at 720p (about $5 for a
  75-second video) or about 2¢ a second as a 360p draft. It shows the price and asks before charging. A failed scene keeps
  its picture; press **🎬 Clip** on it to retry. The editor mixes the clips' own sound under the voice and drops the music
  right before the big moment.
- **Pictures:** **My pictures/clips** (upload a screenshot or a short Roblox recording per scene, free and best-looking),
  **Text cards** (free, moody backgrounds with big captions), or **AI pictures** (needs billing turned on in AI Studio,
  about 3–7¢ a picture, roughly 50¢ a video). You can mix: upload some scenes, leave others as cards.
- **Export** records in real time, so a 75-second video takes 75 seconds. Keep the tab open and in front. Use Chrome or
  Edge on your PC to get MP4.
- Voice and pictures are saved in your browser, so you don't spend free voices twice.

## Stuck or broken?

While it works, a window shows each step live: connect → send → AI is thinking → writing it out (with a running
count of scenes) → check the answer, plus a timer. If Google doesn't answer in time it stops on its own, marks the
step in red, and says why. Press **Copy report for Claude** and paste it to Claude. It has the step, the error and a
log of what happened (never your key). The same log is in **Settings → Activity log**.

## Changing the formula

Everything the AI is told lives in `prompts.js`. Send Claude your analytics and it can tune the formula there;
the site updates a minute after the change is pushed.

Fonts: Poppins (SIL Open Font License).
