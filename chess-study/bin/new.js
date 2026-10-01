const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');

const UPSTREAM = 'https://github.com/muricristino/learno.git';

// The engine's own study lives in these; a new workspace starts without it.
const STUDY_DIRS = ['lessons', 'review', 'projects', 'learning-records'];
const STUDY_FILES = ['NEXT.md', 'NOTES.md', 'RESOURCES.md'];

const say = msg => console.log(msg);
const fail = msg => { console.error(`\n✗ ${msg}`); process.exit(1); };

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error?.code === 'ENOENT') return { missing: true };
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function ask(question, fallback) {
  if (!process.stdin.isTTY) return Promise.resolve(fallback);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim() || fallback); }));
}

function checkClaude() {
  const version = run('claude', ['--version']);
  if (version.missing) return { ok: false, why: 'Claude Code is not installed — see https://claude.com/claude-code' };

  const status = run('claude', ['auth', 'status']);
  let auth = {};
  try { auth = JSON.parse(status.out); } catch {}
  if (!auth.loggedIn) return { ok: false, why: 'Claude Code is not logged in — run `claude` once and log in' };

  return { ok: true, billed: auth.authMethod !== 'claude.ai' };
}

function emptyStudy(dir) {
  for (const d of STUDY_DIRS) {
    const full = path.join(dir, d);
    fs.rmSync(full, { recursive: true, force: true });
    fs.mkdirSync(full);
    fs.writeFileSync(path.join(full, '.gitkeep'), '');
  }
  for (const f of STUDY_FILES) fs.rmSync(path.join(dir, f), { force: true });

  // Ignored upstream so the engine's author does not publish their progress; a
  // study workspace is exactly where it should be versioned.
  const gi = path.join(dir, '.gitignore');
  const kept = fs.readFileSync(gi, 'utf8').split('\n')
    .filter(l => l !== 'learno.db' && !/^# (This repo is public|A study workspace created)/.test(l));
  fs.writeFileSync(gi, kept.join('\n'));
}

async function create(args) {
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const from = flag('--from') || UPSTREAM;
  let lang = flag('--lang');
  const noLaunch = args.includes('--no-launch');
  const target = args.find(a => !a.startsWith('--')) || await ask('Folder for the study [learno-study]: ', 'learno-study');
  const dir = path.resolve(target);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`${dir} already exists and is not empty.`);

  say('Checking what this needs…');
  if (run('git', ['--version']).missing) fail('git is not installed.');
  const claude = checkClaude();
  say(claude.ok ? '  ✓ Node, git and Claude Code' : `  ! ${claude.why}. The workspace is still created; start Claude once that is fixed.`);
  if (claude.ok && claude.billed) {
    say('  ! Claude Code is using an API key, so grading each answer is billed to it. A Claude subscription login is not.');
  }

  const systemLang = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('pt') ? 'pt' : 'en';
  while (lang !== 'pt' && lang !== 'en') {
    lang = (await ask(`\nLesson language — pt or en? [${systemLang}] `, systemLang)).toLowerCase();
  }

  say(`\nCreating ${dir}…`);
  const clone = run('git', ['clone', '--quiet', from, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!clone.ok) fail(`git clone failed: ${clone.err}`);
  run('git', ['remote', 'rename', 'origin', 'upstream'], { cwd: dir });

  emptyStudy(dir);
  fs.writeFileSync(path.join(dir, 'learno.json'), JSON.stringify({ lang }, null, 2) + '\n');

  say('Installing dependencies…');
  for (const sub of ['.', 'server']) {
    const npm = run('npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: path.join(dir, sub) });
    if (!npm.ok) fail(`npm install failed in ${sub}: ${npm.err}`);
  }

  run('git', ['add', '-A'], { cwd: dir });
  run('git', ['commit', '--quiet', '-m', 'chore: start a new study'], { cwd: dir });

  say(`\n✓ Ready: ${dir}\n`);

  // Inside Claude Code (`! npx …`) there is no terminal to hand over: the output
  // lands in the running conversation, so it tells that Claude what to do next.
  if (process.env.CLAUDECODE || !process.stdin.isTTY) {
    say(handoff(dir));
    return;
  }

  if (noLaunch || !claude.ok) {
    say(`  Start studying: cd ${target} && claude "/learno"\n`);
    return;
  }
  say('Opening Claude…\n');
  spawn('claude', ['/learno'], { cwd: dir, stdio: 'inherit' })
    .on('exit', code => process.exit(code ?? 0));
}

function handoff(dir) {
  return [
    '── For Claude ──',
    `The user just created a learno study at ${dir}. When they reply:`,
    '- Always answer in the language they write in, and write the lessons in it, whatever it is.',
    '  learno.json only picks the language of the buttons: {"lang": "pt"} for Portuguese, else {"lang": "en"}.',
    `- Read ${path.join(dir, 'SKILL.md')} and follow "First run": the interview comes before any lesson.`,
    `- Work only inside that folder: cd ${dir} before every command.`,
    '- They may not be technical. Never ask them to run a command; run it yourself.',
    `- The learno-analyst agent is not loaded in this session. For progress, run node ${path.join(dir, 'bin', 'learno.js')}`,
    '  status | due | misconceptions | lesson <id> yourself. From the next session on, Claude opened inside the folder has it.',
    '──',
    '',
    'learno is a tutor that lives in this folder. It asks what you want to learn and why,',
    'finds the best sources on it, and teaches in short lessons you answer in your own words.',
    'It remembers what you got wrong and brings each topic back just before you would forget it.',
    '',
    'When you are ready, just tell Claude — in your own language. For example: "let\'s start".',
    ''
  ].join('\n');
}

module.exports = { create };
