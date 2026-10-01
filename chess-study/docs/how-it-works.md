# How it works

learno is a Claude Code skill (`SKILL.md`) with a small engine around it. Claude plays the
tutor. The engine turns what Claude writes into lesson pages, grades your answers, and
remembers the results.

## The first session

Nothing is taught until four things exist:

1. A mission in `MISSION.md`. Not "learn chess" but something that can be won or lost on
   a given day, such as "reach 1200 on Lichess rapid by March". Claude also says up front which
   parts of the goal it cannot teach (playing games, speaking hours, driving lessons) and
   writes them down as out of scope.
2. A profile in `NOTES.md`: how you learn, how much time you have, what failed before.
3. Sources in `RESOURCES.md`, ranked in tiers. Claude looks for the books and papers the
   field treats as standard, and asks whether you already own any.
4. A curriculum made of patterns: groups of concepts that close together.

Then the first lesson.

## Every session after that

Claude reads the mission, your notes and your progress, then opens by telling you where you
stand: what is due for review, what you keep getting wrong, what comes next. It picks the
lesson in that order: reviews that are due, then a concept with a repeated mistake, then the
next step toward the mission.

When a lesson ends, Claude reads your score for each section, asks what felt confusing and
what felt too easy, and compares the two. A section you found easy and scored 55 on is the
gap you cannot see yourself, so the next session starts there. It writes where to go next in
`NEXT.md`, which is the first thing the dashboard shows.

## Three kinds of lesson

| Kind | Folder | What it is |
|---|---|---|
| Lesson | `lessons/` | Teaches one concept. Opens with an everyday analogy, then two to five sections, each with a diagram and an exercise. Ends with a teach-back, where you explain the whole thing, and flash cards. |
| Review | `review/` | Tests before it explains. No analogy and no flash cards. Each round is harder: R1 may show a diagram, R2 does not, R3 asks you to use the concept somewhere new. |
| Project | `projects/` | Comes when a whole pattern is mastered. You build the real thing (code that runs, a proof, a text in the language you study) against a rubric you can read before you start. Claude evaluates it in the conversation. |

Exercises come in two forms. A recall asks you to explain in your own words and a model grades
it. A quiz is multiple choice and is checked on the page. Every lesson has at least one recall,
because recognizing an answer is easier than producing one. Answering a section opens the
next one whatever the score; the low scores are what the next lesson aims at.

## Mastery and review

A concept counts as learned when one of three things confirms it, and the dashboard shows
which:

| Source | How |
|---|---|
| Graded answer | You score 75 or more on the lesson's teach-back. |
| Conversation | You use the concept correctly in chat without being asked. |
| Project | You applied it in a situation you were never taught, and the result met the rubric. |

Reviews are scheduled with SM-2. The teach-back score decides when a concept comes back: a
strong answer pushes it further out, a weak one brings it back the next day, or the same day if it scored under 40. Passing a project
pushes the interval 1.5 times further than the same score on a lesson. Failing one only
demotes the concepts Claude names as the cause, since a project touches several at once.

You do not have to remember the dates. Before every message you send Claude inside the study
folder, a hook (`bin/due-hook.js`, about 50 ms) checks for reviews that are due. If there are
none it says nothing. If there are, Claude mentions them once per session and offers to do them.

Mistakes are grouped across every answer you have given. A misconception that shows up in
two different lessons is treated as more important than any single score, and the dashboard
lists it first.

## Grading

Free-text answers are graded by your own Claude Code (`claude -p` with Haiku), so no API key
is needed. It takes about ten seconds per answer. With `GEMINI_API_KEY` set, Gemini grades
instead in two or three seconds. See [workspace.md](workspace.md#settings).

## Offline

Lessons check for the local server when they load. Without it, each recall shows a
multiple-choice version instead and a banner says so. Nothing is saved in that mode, and the
teach-back cannot be graded.
