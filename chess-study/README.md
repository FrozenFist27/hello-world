# learno

A tutor that runs inside Claude Code and keeps track of what you actually understand.

Tell it what you want to learn. It asks why, and what you need to be able to do by when, then
finds the standard books on the subject and teaches in lessons you can finish in one sitting.
You answer in your own words and a model grades what you wrote. Each concept comes back for
review around the time you would forget it, and a mistake you keep making gets named.

Your lessons, answers and scores stay in one folder on your computer.

<table>
  <tr>
    <td width="50%" valign="top"><img alt="A lesson opening with an everyday analogy" src="docs/images/lesson.png"><br><sub>Every lesson opens with an everyday analogy before the term.</sub></td>
    <td width="50%" valign="top"><img alt="A free-text answer with its score and feedback" src="docs/images/answer.png"><br><sub>You answer in your own words; a model scores it and says what is missing.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img alt="The teach-back at the end of a lesson" src="docs/images/teachback.png"><br><sub>The teach-back: explain the whole topic. Its score schedules the review.</sub></td>
    <td width="50%" valign="top"><img alt="The dashboard with the next step and what is due" src="docs/images/dashboard.png"><br><sub>The dashboard opens with what to do next and what is due.</sub></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><img alt="The library of lessons, reviews and projects with scores" src="docs/images/library.png"><br><sub>The library: every lesson, review and project, with your score.</sub></td>
    <td width="50%" valign="top"><img alt="A diagram in dark mode" src="docs/images/diagram.png"><br><sub>Diagrams are drawn for each lesson and follow light or dark mode.</sub></td>
  </tr>
</table>

## Get started

You need Node 22.13 or newer, git, and Claude Code with a logged-in account. No API keys.

```bash
npx muricristino/learno new chess
```

This creates a `chess` folder and opens Claude in it. If you are already in a Claude Code
session, run the same command there with `!` in front, then send any message, like "let's
start":

```
! npx muricristino/learno new chess
```

## What studying looks like

The first session is a conversation: what you want to learn, why, by when, and how much time
you have. Claude writes that down as your goal and plans the topics around it.

Each lesson opens with an everyday analogy, asks you to explain the idea back, and schedules
its review. When you finish a whole topic, you get a project: build or write the real thing,
against a rubric you can read before you start.

To continue another day, open Claude in the study folder and type `/learno`. It starts with
what is due and what keeps going wrong. The same is on the dashboard at
http://localhost:9990 while the local server runs.

Any subject works, from chess openings to Kant, in the language you write to Claude in.

## Learn more

- [How it works](docs/how-it-works.md): the lesson loop, the kinds of lesson, mastery and review.
- [Your study folder](docs/workspace.md): what each file is, language, settings, updates.
- [The engine](docs/engine.md): the lesson format, the server, the progress store, development.
