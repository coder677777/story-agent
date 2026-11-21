// Story Agent: everything the AI is told lives in this file, so the formula can be tuned
// without touching the app. Based on a breakdown of @pov.deadlinestories (Nov 2026):
// "In our town" emotional-twist stories got 26K-1.8M plays; plain horror "comment A or B" posts got 1-2K.

export const STYLES = {
  town: {
    name: "In our town",
    tag: "Proven",
    blurb: "A strange rule everyone in town lives by, a family story, and a twist that hits hard.",
    guide: `STYLE: "In our town" emotional twist (the format that went viral).
- The very first spoken line states a magical rule of the narrator's town: "In our town, <rule>. <limit>."
- The rule must have a hard limit (once, seven days, one minute, until you turn 13...). The limit creates the stakes.
- Spend 2 quick beats showing how other townspeople use or waste the rule. One should be a deadpan joke
  (e.g. "Greg used his on a dropped ice cream. He was four. We don't talk about it.").
- Then "I'm <name>." and how the rule touches the narrator's life and someone they love (grandpa, mom, sister, best friend).
- Build to one high-stakes moment, then a twist that reframes everything: a quiet sacrifice, or the narrator
  was wrong about who the rule was happening to.
- End warm or bittersweet, never gory.`,
  },
  mystery: {
    name: "Mystery clues",
    tag: "Rewatch bait",
    blurb: "A puzzle viewers try to solve. Clues hide in plain sight, and the ending makes them rewatch.",
    guide: `STYLE: mystery with hidden clues.
- Open on a strange fact that is impossible to scroll past ("Every night at 3:04 AM a new photo shows up in my gallery").
- The narrator is a character we care about, with someone they love involved (not a blank "you").
- Plant 3 visual clues that make sense only after the reveal (backwards writing, a missing object, a wrong reflection,
  a clock that never moves, someone who never speaks to the narrator).
- The reveal must be fair: a viewer who rewatches can find every clue.
- Deliver a full answer in this video. Mystery stays, but the story is complete.`,
  },
  eerie: {
    name: "Eerie but emotional",
    tag: "Darker",
    blurb: "Creepy atmosphere, but the scare turns out to be about love or loss.",
    guide: `STYLE: eerie, dark atmosphere with an emotional core.
- Creepy setup (night, an empty place, something that should not be there) told by a named narrator.
- The "monster" or strange thing turns out to have a human, emotional reason (a protector, a lost family member, a warning).
- No jump-scare gore, no blood. Dread comes from silence, sound and small wrong details.
- Do NOT end on "comment A or B". That format flopped. End with a complete twist and a rewatch line.`,
  },
};

export const FORMULA = `You write scripts for vertical short videos (Instagram Reels, TikTok, YouTube Shorts) in the style of
Roblox / blocky low-poly animated stories narrated by a kid or teen. Your stories must be engaging, dramatic and mysterious.

WHAT MAKES THESE GO VIRAL (follow all of it):
1. HOOK IN 3 SECONDS: the first spoken line states the premise. No intro, no "hey guys", no title card.
2. A RULE WITH A LIMIT: the world has one strange rule and a hard limit, so viewers instantly understand the stakes.
3. FUNNY WORLD-BUILDING: 1-2 deadpan side examples of other people using the rule make the world feel real
   and make the sad part hit harder by contrast.
4. A NARRATOR WE CARE ABOUT: short, plain, kid-like sentences in first person. "I'm Sam. My button is still red."
   Max ~12 words per sentence. Lots of full stops. Quiet confidence, no big words.
5. FAMILY OVER MONSTERS: the heart is a grandpa, mom, dad, sibling or best friend. Love, sacrifice, loss, promises.
6. A TWIST THAT REFRAMES EVERYTHING: on rewatch, earlier lines mean something different.
7. HIDDEN CLUES FOR REWATCHING: plant 2-4 visual details that only make sense after the twist, then end with a short
   on-screen line telling viewers exactly where to look ("Rewatch the miss. Look at Grandpa's hand.").
8. SOUND FOLLOWS EMOTION: music drops out before the big moment, one sharp sound effect at the turning point
   (CLANG, a long beep, a door click), soft piano or strings for the ending.
9. EVERY LINE IS ALSO ON SCREEN: big captions, because most people watch with the sound off.
10. PACING: 1-2 second cuts during setup, slower lingering shots for emotion. 60-90 seconds total.
11. SERIES HOOK (optional): a complete story first, then one new small mystery at the very end that sets up Part 2
    (a note, a box in the attic, a button that changes color). Never end on "comment A or B".

AVOID: generic creepypasta (haunted elevator, floor 13), blank "you" protagonists, choose-your-path endings, gore,
blood, self-harm, real brands, real people, copyrighted characters, and copying existing viral stories. Every premise must be original.`;

export const IDEA_SHAPE = `Return JSON only, shaped like this:
{"ideas": [{
  "title": "short series name, 1-3 words",
  "hook": "the exact first spoken line, under 22 words",
  "cover_text": ["big line 1 for the cover, under 6 words", "small line 2, under 7 words"],
  "characters": "the narrator and the person they love, one line",
  "story": "the full story in 2-3 sentences, including the twist",
  "twist": "the twist in one sentence",
  "clue": "the main hidden clue viewers can find on rewatch",
  "emotion": "the main feeling, 1-3 words",
  "why": "why this will make people rewatch, comment or share, one sentence"
}]}`;

export const SCRIPT_SHAPE = `Return JSON only, shaped like this:
{
  "title": "series name",
  "part": 1,
  "length_seconds": 75,
  "cover_text": ["big line 1, under 6 words", "small line 2, under 7 words"],
  "hook": "the first spoken line",
  "scenes": [{
    "time": "0:00-0:03",
    "visual": "what we see: setting, characters, action",
    "camera": "shot type and movement, e.g. close-up push-in, wide, over-the-shoulder",
    "vo": "the narrator's exact words for this scene",
    "text": "short on-screen text or label beyond the captions (e.g. 'YEAR 29', 'DAY 7', 'CLANG'), or empty",
    "sound": "music and sound effects",
    "clue": "the hidden clue planted in this scene, or empty"
  }],
  "clues": [{"time": "0:35", "what": "what is hidden", "means": "what it means after the twist"}],
  "twist": "explain the twist in 1-2 sentences",
  "ending_text": "the last on-screen line telling viewers what to rewatch",
  "caption": "Instagram caption: the hook, one emotional line, and the rewatch line, with 1-2 emojis",
  "hashtags": ["#roblox", "#robloxstory", "#storytime", "#animation", "#fyp"],
  "pinned_comment": "a comment to pin under the video that drives follows or debate",
  "next_part": "one sentence: the new mystery that sets up the next part, or empty if the story should stand alone",
  "why_it_works": "2 sentences on why viewers will watch to the end and rewatch"
}
Write 12-20 scenes. Scene times must be continuous and end at length_seconds.
The "vo" lines read in order must be the complete voiceover.`;

export function ideasPrompt({ style, count, theme, avoid }) {
  return `${FORMULA}

${STYLES[style].guide}

Come up with ${count} different, original story ideas in this style.
${theme ? `The user wants them to be about or inspired by: "${theme}". Use it creatively.` : "Mix different settings: school, sports, home, a family trip, a birthday, a holiday, a small-town tradition."}
Make every idea feel different from the others: different rules, different loved ones, different kinds of twist.
${avoid.length ? `Do NOT reuse or closely resemble these earlier ideas: ${avoid.map((t) => `"${t}"`).join(", ")}.` : ""}

${IDEA_SHAPE}`;
}

export function ideasFromPromptPrompt({ style, text, count }) {
  return `${FORMULA}

${STYLES[style].guide}

The user pasted this as inspiration (it might be a viewer comment, a request, a "what if", or a rough idea):
"""${text}"""

Turn it into ${count} different story ideas that keep what the user is asking for but use the viral formula above.
If it is a comment asking for a sequel or a specific situation, honor that request.

${IDEA_SHAPE}`;
}

export function scriptPrompt({ style, idea, text, length }) {
  const source = idea
    ? `Write the full script for this idea:\n${JSON.stringify(idea, null, 2)}`
    : `Write the full script based on this, which the user pasted (it might be a viewer comment, a request or a rough idea).
Honor what it asks for, but use the viral formula:\n"""${text}"""`;
  return `${FORMULA}

${STYLES[style].guide}

${source}

Target length: about ${length} seconds of narration (roughly ${Math.round(length * 2.4)} spoken words).

${SCRIPT_SHAPE}`;
}

export function nextPartPrompt({ style, script, length, note }) {
  return `${FORMULA}

${STYLES[style].guide}

Here is Part ${script.part || 1} of a series:
${JSON.stringify(compact(script), null, 2)}

Write Part ${(script.part || 1) + 1}.
- The first spoken line restates the town rule in one sentence (new viewers start here).
- Then a 3-5 second recap of the previous part ("Last time, ...") with on-screen text "PART ${script.part || 1}".
- Pay off the teaser it ended on: ${script.next_part || "continue the story naturally"}.
- Raise the emotional stakes, deliver a new twist, and keep it a complete episode.
${note ? `The user also wants: "${note}".` : ""}
Target length: about ${length} seconds.

${SCRIPT_SHAPE}
Set "part" to ${(script.part || 1) + 1}.`;
}

export const TWEAKS = {
  emotional: "Make it more emotional: deeper love between the characters, a quieter and more heartbreaking ending, more specific small details that make people tear up.",
  mysterious: "Make it darker and more mysterious: more unsettling atmosphere, more questions early on, a sharper twist, and one more hidden clue.",
  twist: "Make the twist bigger and more surprising, but still fair. Viewers who rewatch must be able to find the clues.",
  shorter: "Cut it to about 60 seconds. Keep the hook, the rule, the twist and the clues. Make every line count.",
  funnier: "Add more deadpan humor in the world-building, like the 'Greg used his on ice cream' joke, without weakening the emotional ending.",
  hook: "Rewrite the first 3 seconds and the cover text so they are impossible to scroll past. Keep the rest of the story.",
};

export function tweakPrompt({ style, script, ask }) {
  return `${FORMULA}

${STYLES[style].guide}

Here is the current script:
${JSON.stringify(script, null, 2)}

Rewrite it with this change: ${ask}
Keep everything that already works. Keep the same part number.

${SCRIPT_SHAPE}`;
}

function compact(s) {
  return {
    title: s.title, part: s.part, hook: s.hook, twist: s.twist, next_part: s.next_part,
    voiceover: (s.scenes || []).map((x) => x.vo).join(" "),
  };
}
